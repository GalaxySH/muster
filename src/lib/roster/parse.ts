/**
 * Pure roster parsing/classification (PLAN.md §4.2, §9, §16).
 *
 * Maps raw "People Coming" rows to students / admins / skipped, applying data
 * minimization (only name, email, position, international are carried — never
 * Campus ID, phone, or tracking columns). No I/O; unit-tested with synthetic
 * rows. The xlsx reading lives in ./read-workbook.
 */
import { normalizeEmail, isWiscEmail } from "@/lib/auth/policy";
import { TITLE_TO_POSITION, ADMIN_TITLES, SKIP_TITLES, normalizeTitle } from "./position-mapping";

/** A raw row extracted from the workbook (cell values already stringified). */
export interface RawRosterRow {
  name: string;
  positionTitle: string;
  email: string;
  international: string;
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
  /** null when the title has no mapping — student self-reports at onboarding. */
  positionId: string | null;
  international: boolean;
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

export function parseRoster(rows: readonly RawRosterRow[]): RosterParseResult {
  const result: RosterParseResult = {
    students: [],
    admins: [],
    skipped: [],
    unmappedTitles: new Map(),
  };

  for (const row of rows) {
    const email = normalizeEmail(row.email ?? "");
    const displayName = (row.name ?? "").trim();
    const title = normalizeTitle(row.positionTitle ?? "");

    if (!email) {
      result.skipped.push({ reason: "missing_email", detail: displayName || "(no name)" });
      continue;
    }
    if (!isWiscEmail(email)) {
      result.skipped.push({ reason: "non_wisc_email", detail: email });
      continue;
    }
    if (SKIP_TITLES.has(title)) {
      result.skipped.push({ reason: "excluded_title", detail: `${displayName} — ${title}` });
      continue;
    }
    if (ADMIN_TITLES.has(title)) {
      result.admins.push({ email, displayName });
      continue;
    }

    const positionId = TITLE_TO_POSITION[title] ?? null;
    if (positionId === null) {
      result.unmappedTitles.set(title, (result.unmappedTitles.get(title) ?? 0) + 1);
    }
    result.students.push({
      email,
      displayName,
      positionId,
      international: parseInternational(row.international ?? ""),
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
  /** People only in "People Leaving" — genuinely gone; mark off-roster. */
  markLeft: LeavingStudent[];
  /**
   * People in BOTH sheets: a promotion/position change moves the old row to
   * "People Leaving" and adds a fresh "People Coming" entry. They stay active
   * with their People Coming classification — reported, never marked left.
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
