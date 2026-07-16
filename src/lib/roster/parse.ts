/**
 * Pure roster parsing/classification (PLAN.md §4.2, §9, §16).
 *
 * Maps raw "People Coming" rows to students / admins / skipped, applying data
 * minimization (only name, email, position, international are carried, never
 * Campus ID, phone, or tracking columns). The title-to-position map and the
 * excluded-title set are injected by the caller (the importer builds them from
 * roster_title_mappings and app_settings; see buildEffectiveTitleMap and
 * effectiveExcludedTitles), keeping this module pure. No I/O; unit-tested
 * with synthetic rows. The xlsx reading lives in ./read-workbook.
 */
import { normalizeEmail, isWiscEmail } from "@/lib/auth/policy";
import { ADMIN_TITLES, normalizeTitle } from "./position-mapping";

/** A raw row extracted from the workbook (cell values already stringified). */
export interface RawRosterRow {
  name: string;
  positionTitle: string;
  email: string;
  international: string;
  /** Hire date as an ISO `yyyy-mm-dd` string, or "" when absent (PLAN §9). */
  hireDate: string;
}

/** A name+email pair from the "People Leaving" sheet (cell values stringified). */
export interface RawLeavingRow {
  name: string;
  email: string;
}

/** A leaving person to mark off-roster (email normalized, name trimmed). */
export interface LeavingStudent {
  email: string;
  displayName: string;
}

export interface RosterStudent {
  email: string;
  displayName: string;
  /** null when the title has no mapping; resolved by an admin on /admin/positions. */
  positionId: string | null;
  international: boolean;
  /** Hire date (midnight UTC), or null when absent/unparseable. */
  hiredOn: Date | null;
  /** The raw trimmed PCPL title, stored so ghost titles stay traceable. */
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
}

function parseInternational(value: string): boolean {
  return value.trim().toLowerCase().startsWith("y");
}

/** Parse an ISO `yyyy-mm-dd` hire date to a UTC-midnight Date, or null if blank/invalid. */
export function parseHireDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
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
 * Pure classification of "People Leaving" rows into the students to mark
 * off-roster. Mirrors parseRoster's email handling: normalize, then drop empty
 * / non-wisc emails (they could never have matched a roster/sign-in identity).
 * De-duplicates on email so a person listed twice is marked once.
 */
export function parseLeaving(rows: readonly RawLeavingRow[]): LeavingStudent[] {
  const byEmail = new Map<string, LeavingStudent>();
  for (const row of rows) {
    const email = normalizeEmail(row.email ?? "");
    if (!email || !isWiscEmail(email)) continue;
    byEmail.set(email, { email, displayName: (row.name ?? "").trim() });
  }
  return [...byEmail.values()];
}

export interface LeavingReconciliation {
  /** People only in "People Leaving": genuinely gone; mark off-roster. */
  markLeft: LeavingStudent[];
  /**
   * People in BOTH sheets: a promotion/position change moves the old row to
   * "People Leaving" and adds a fresh "People Coming" entry. They stay active
   * with their People Coming classification: reported, never marked left.
   */
  movedWithinWorkbook: LeavingStudent[];
}

/** Pure reconciliation of the two sheets: People Coming wins over People Leaving. */
export function reconcileLeaving(
  parsed: RosterParseResult,
  leaving: readonly LeavingStudent[],
): LeavingReconciliation {
  const coming = new Set([
    ...parsed.students.map((s) => s.email),
    ...parsed.admins.map((a) => a.email),
  ]);
  const result: LeavingReconciliation = { markLeft: [], movedWithinWorkbook: [] };
  for (const l of leaving) {
    (coming.has(l.email) ? result.movedWithinWorkbook : result.markLeft).push(l);
  }
  return result;
}

/**
 * Pure reconciliation of People Coming admins against the current student
 * roster: someone promoted to a supervisor title is no longer a student
 * worker, so an active students row of theirs must flip off-roster (their
 * submission stays, like any People Leaving departure). A person the workbook
 * also lists under a student title keeps their student row. Returns the
 * emails to flip, de-duplicated and sorted.
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
