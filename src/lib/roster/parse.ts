/**
 * Pure roster parsing/classification (PLAN.md §4.2, §9, §16).
 *
 * Turns a sheet grid into rows (`extractRosterRows`), then classifies those
 * rows into active students / admins / people to take off the roster
 * (`parseRoster`), applying data minimization: only name, title, email,
 * international and start date are carried, never Campus ID, phone, res hall,
 * proficiency or any onboarding-tracking column.
 *
 * The roster tracker has one sheet per dining unit with a **Status** column
 * (Active / Inactive), which is the on-roster signal; there is no longer a
 * separate leavers sheet. Someone missing from the sheet entirely is handled
 * by the caller through `evaluateAbsenceGuard`.
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
  /** Raw Status cell; "" when the sheet has no Status column (older workbooks). */
  status: string;
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

/** Someone the sheet marks Inactive: taken off the roster, never created. */
export interface InactiveStudent {
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
  inactive: InactiveStudent[];
  skipped: SkippedRow[];
  /** normalized titles that mapped to no position, with occurrence counts. */
  unmappedTitles: Map<string, number>;
  /** Status values that are neither Active nor Inactive, with counts. Treated as active. */
  unrecognizedStatuses: Map<string, number>;
  /**
   * Every valid roster email the sheet listed, whatever its status. Anyone
   * on-roster in the database but absent from this set is missing from the
   * workbook (see evaluateAbsenceGuard). Skipped rows are deliberately not
   * counted: an excluded title means the person is no longer tracked here.
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
  // Optional: not every sheet carries a status or a start date.
  const statusCol = findColumn(headers, [exact("status")]);
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
      status: cell(row, statusCol),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Row classification
// ---------------------------------------------------------------------------

export type StatusKind = "active" | "inactive" | "unrecognized";

/**
 * Read the Status cell. Only "Inactive" takes someone off the roster; a blank
 * status (or a sheet with no Status column) means active. Anything else is
 * reported rather than guessed at, and left active, so a status nobody has
 * taught the importer yet can't quietly drop people.
 */
export function classifyStatus(raw: string): StatusKind {
  const status = raw.trim().toLowerCase();
  if (status === "" || status === "active") return "active";
  if (status === "inactive") return "inactive";
  return "unrecognized";
}

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
    inactive: [],
    skipped: [],
    unmappedTitles: new Map(),
    unrecognizedStatuses: new Map(),
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

    const status = classifyStatus(row.status ?? "");
    if (status === "inactive") {
      result.inactive.push({ email, displayName });
      continue;
    }
    if (status === "unrecognized") {
      const raw = (row.status ?? "").trim();
      result.unrecognizedStatuses.set(raw, (result.unrecognizedStatuses.get(raw) ?? 0) + 1);
    }

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

/** Share of the current roster that may vanish from a sheet before the guard trips. */
export const ABSENCE_GUARD_SHARE = 0.2;
/** Small rosters always tolerate at least this many absences. */
export const ABSENCE_GUARD_FLOOR = 10;

export interface AbsenceGuardResult {
  /** The most absences that get applied without an explicit override. */
  limit: number;
  /** True when the import refused to act on the absences. */
  tripped: boolean;
  /** True when the absent students were taken off the roster. */
  applied: boolean;
}

/**
 * Absence from the sheet is an inference, not a stated departure, so a partial
 * or wrong-sheet upload could otherwise take most of the roster off in one go.
 * Past the limit the import leaves everyone on and reports what it would have
 * done; the admin re-runs with the override once they've checked the file.
 */
export function evaluateAbsenceGuard(
  absentCount: number,
  onRosterCount: number,
  override = false,
): AbsenceGuardResult {
  const limit = Math.max(ABSENCE_GUARD_FLOOR, Math.ceil(onRosterCount * ABSENCE_GUARD_SHARE));
  const exceeded = absentCount > limit;
  return { limit, tripped: exceeded && !override, applied: !exceeded || override };
}
