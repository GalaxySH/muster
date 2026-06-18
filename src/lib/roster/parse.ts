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
