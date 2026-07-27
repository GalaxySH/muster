/**
 * Pure roster parsing/classification (PLAN.md §4.2, §9, §16).
 *
 * Turns a sheet grid into rows (`extractRosterRows`), then classifies those
 * rows into students and admins (`parseRoster`), applying data minimization:
 * only name, title, email, international and start date are carried, never
 * Campus ID, phone, res hall, proficiency, **Status**, or any onboarding
 * column. Status is an administrative marker that says nothing about roster
 * membership, so it is deliberately not read.
 *
 * **Being listed in the sheet is what puts someone on the roster.** The
 * tracker has one sheet per dining unit and no leavers sheet; people come off
 * the roster by dropping out of the sheet, which the caller applies through
 * `evaluateAbsenceGuard`.
 *
 * The title-to-position map and the excluded-title set are injected by the
 * caller (the importer builds them from roster_title_mappings and
 * app_settings), keeping this module pure. No I/O; unit-tested with synthetic
 * rows. Reading bytes into a grid lives in ./read-workbook.
 */
import { normalizeEmail, isWiscEmail } from "@/lib/auth/policy";
import { ADMIN_TITLES, normalizeTitle } from "./position-mapping";

/** A workbook whose shape we can't make sense of. Surfaced to the admin verbatim. */
export class RosterFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterFormatError";
  }
}

/** A raw row extracted from the sheet (cell values already stringified). */
export interface RawRosterRow {
  name: string;
  positionTitle: string;
  email: string;
  international: string;
  /** Start date as `yyyy-mm-dd` or `yyyy/mm/dd`, or "" when absent (PLAN §9). */
  hireDate: string;
}

export interface RosterStudent {
  email: string;
  displayName: string;
  /** null when the title has no mapping; resolved by an admin on /admin/positions. */
  positionId: string | null;
  international: boolean;
  /** Start date (midnight UTC), or null when absent/unparseable. */
  hiredOn: Date | null;
  /** The raw trimmed tracker title, stored so ghost titles stay traceable. */
  rosterTitle: string | null;
}

export interface RosterAdmin {
  email: string;
  displayName: string;
}

export interface SkippedRow {
  reason: "missing_email" | "non_wisc_email" | "excluded_title";
  detail: string;
}

export interface RosterParseResult {
  students: RosterStudent[];
  admins: RosterAdmin[];
  skipped: SkippedRow[];
  /** normalized titles that mapped to no position, with occurrence counts. */
  unmappedTitles: Map<string, number>;
  /**
   * Every valid roster email the sheet listed. Listing someone is what puts
   * them on the roster, so anyone on-roster in the database but absent from
   * this set has left (see evaluateAbsenceGuard). Skipped rows are
   * deliberately not counted: an excluded title means they aren't tracked here.
   */
  seenEmails: Set<string>;
}

// ---------------------------------------------------------------------------
// Grid to rows
// ---------------------------------------------------------------------------

/**
 * How many leading rows to scan for the header. The tracker puts a merged
 * section banner ("Employee Information", "Orientation", ...) above the real
 * header, so the columns are on row 2; older single-header workbooks have
 * them on row 1.
 */
const HEADER_SCAN_ROWS = 5;

type HeaderMatcher = (header: string) => boolean;
const exact =
  (want: string): HeaderMatcher =>
  (h) =>
    h === want;
const contains =
  (want: string): HeaderMatcher =>
  (h) =>
    h.includes(want);

const NAME_MATCHERS = [exact("name")];
const EMAIL_MATCHERS = [exact("email"), contains("email")];

/**
 * The first column matching any matcher, matchers tried in order across the
 * whole header row. Order matters: the tracker has both "Email" and "Welcome
 * Email", so the exact match has to win regardless of column position.
 */
function findColumn(headers: readonly string[], matchers: readonly HeaderMatcher[]): number | null {
  for (const match of matchers) {
    const i = headers.findIndex((h) => h !== "" && match(h));
    if (i !== -1) return i;
  }
  return null;
}

function requireColumn(
  headers: readonly string[],
  matchers: readonly HeaderMatcher[],
  label: string,
): number {
  const col = findColumn(headers, matchers);
  if (col === null) throw new RosterFormatError(`Could not find the ${label} column in the sheet.`);
  return col;
}

/** The index of the header row: the first row carrying both a Name and an Email column. */
function findHeaderRow(grid: readonly (readonly string[])[]): number {
  const limit = Math.min(HEADER_SCAN_ROWS, grid.length);
  for (let r = 0; r < limit; r++) {
    const headers = grid[r]!.map(normalizeTitle);
    if (
      findColumn(headers, NAME_MATCHERS) !== null &&
      findColumn(headers, EMAIL_MATCHERS) !== null
    ) {
      return r;
    }
  }
  throw new RosterFormatError(
    "Could not find the header row. The sheet needs a row with Name and Email columns.",
  );
}

/**
 * Pull the minimized fields out of a sheet grid, locating columns by header
 * text so the column order (which differs between unit sheets) doesn't matter.
 */
export function extractRosterRows(grid: readonly (readonly string[])[]): RawRosterRow[] {
  const headerRow = findHeaderRow(grid);
  // Header cells are normalized the same way titles are: trimmed, lowercased,
  // whitespace-collapsed (they wrap across lines in some exports), accents stripped.
  const headers = grid[headerRow]!.map(normalizeTitle);

  const nameCol = requireColumn(headers, NAME_MATCHERS, "Name");
  const titleCol = requireColumn(
    headers,
    [exact("title"), contains("position"), contains("title")],
    "Title",
  );
  const emailCol = requireColumn(headers, EMAIL_MATCHERS, "Email");
  const intlCol = requireColumn(headers, [contains("international")], "International");
  // Optional: not every sheet carries a start date.
  const hireCol = findColumn(headers, [
    exact("start date"),
    contains("start date"),
    contains("hire"),
  ]);

  const cell = (row: readonly string[], col: number | null) =>
    col === null ? "" : (row[col] ?? "").trim();

  const rows: RawRosterRow[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r]!;
    const name = cell(row, nameCol);
    const email = cell(row, emailCol);
    // Skip fully blank rows (the real sheets have them mid-table).
    if (!name && !email) continue;
    rows.push({
      name,
      email,
      positionTitle: cell(row, titleCol),
      international: cell(row, intlCol),
      hireDate: cell(row, hireCol),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Row classification
// ---------------------------------------------------------------------------

function parseInternational(value: string): boolean {
  return value.trim().toLowerCase().startsWith("y");
}

/** Parse a `yyyy-mm-dd` or `yyyy/mm/dd` start date to a UTC-midnight Date, else null. */
export function parseHireDate(value: string): Date | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseRoster(
  rows: readonly RawRosterRow[],
  titleToPosition: ReadonlyMap<string, string>,
  excludedTitles: ReadonlySet<string>,
): RosterParseResult {
  const result: RosterParseResult = {
    students: [],
    admins: [],
    skipped: [],
    unmappedTitles: new Map(),
    seenEmails: new Set(),
  };

  for (const row of rows) {
    const email = normalizeEmail(row.email ?? "");
    const displayName = (row.name ?? "").trim();
    const rawTitle = (row.positionTitle ?? "").trim();
    const title = normalizeTitle(rawTitle);

    if (!email) {
      result.skipped.push({ reason: "missing_email", detail: displayName || "(no name)" });
      continue;
    }
    if (!isWiscEmail(email)) {
      result.skipped.push({ reason: "non_wisc_email", detail: email });
      continue;
    }
    if (excludedTitles.has(title)) {
      result.skipped.push({ reason: "excluded_title", detail: `${displayName} · ${title}` });
      continue;
    }

    result.seenEmails.add(email);

    if (ADMIN_TITLES.has(title)) {
      result.admins.push({ email, displayName });
      continue;
    }

    const positionId = titleToPosition.get(title) ?? null;
    if (positionId === null) {
      result.unmappedTitles.set(title, (result.unmappedTitles.get(title) ?? 0) + 1);
    }
    result.students.push({
      email,
      displayName,
      positionId,
      international: parseInternational(row.international ?? ""),
      hiredOn: parseHireDate(row.hireDate ?? ""),
      rosterTitle: rawTitle || null,
    });
  }

  return result;
}

/**
 * Pure reconciliation of sheet admins against the current student roster:
 * someone promoted to a supervisor title is no longer a student worker, so an
 * active students row of theirs must flip off-roster (their submission stays,
 * like any departure). A person the sheet also lists under a student title
 * keeps their student row. Returns the emails to flip, de-duplicated and sorted.
 */
export function reconcileAdmins(
  parsed: RosterParseResult,
  onRosterEmails: ReadonlySet<string>,
): string[] {
  const studentEmails = new Set(parsed.students.map((s) => s.email));
  const flip = new Set(
    parsed.admins
      .map((a) => a.email)
      .filter((email) => onRosterEmails.has(email) && !studentEmails.has(email)),
  );
  return [...flip].sort();
}

// ---------------------------------------------------------------------------
// Absence guard
// ---------------------------------------------------------------------------

/** Share of the roster that may be taken off in one import before it is refused. */
export const ABSENCE_GUARD_SHARE = 0.2;

export interface AbsenceGuardResult {
  /** The most students that may be taken off without an override. */
  limit: number;
  /** True when the import must not run at all. */
  blocked: boolean;
}

/**
 * An all-or-nothing gate. Being missing from the sheet is what takes someone
 * off the roster, so a partial or wrong-sheet upload would retire most of the
 * roster in one go. Past the limit the whole import is refused rather than
 * partly applied, leaving the database untouched; the admin re-runs with the
 * override once they've checked the file.
 */
export function evaluateAbsenceGuard(
  absentCount: number,
  onRosterCount: number,
  override = false,
): AbsenceGuardResult {
  const limit = Math.floor(onRosterCount * ABSENCE_GUARD_SHARE);
  return { limit, blocked: !override && absentCount > onRosterCount * ABSENCE_GUARD_SHARE };
}

/**
 * The absence guard refused the import. Carries the detail the admin needs to
 * decide whether to override, and is thrown before anything is written.
 */
export class RosterGuardError extends Error {
  constructor(
    readonly absent: string[],
    readonly limit: number,
    readonly rosterCount: number,
  ) {
    super(
      `This sheet is missing ${absent.length} of the ${rosterCount} students on the roster, ` +
        `more than the ${limit} that can be taken off in one import. ` +
        `Nothing was changed. Check that you uploaded the right sheet.`,
    );
    this.name = "RosterGuardError";
  }
}
