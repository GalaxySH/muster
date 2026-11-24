/**
 * How one term's roster tracker is read (docs/semester-domains-plan.md §2.4).
 *
 * The tracker's layout changes from semester to semester: the sheet is renamed,
 * a title is reworded, a new supervisor title appears. So the facts the import
 * needs about the file are settings on the term, stored as JSON in
 * `terms.roster_config`, and this is their shape. Pure: no I/O, so the CLI
 * importer and the admin page share it.
 *
 * Every field falls back to the built-in default on its own, so a term with no
 * stored config, or one saved before a field existed, still imports.
 */
import { ADMIN_TITLES, normalizeTitle } from "./position-mapping";

export interface RosterConfig {
  /** Sheets tried, in order, when the admin doesn't name one. */
  sheetCandidates: string[];
  /** The leavers sheet, read only for resignation dates. */
  leavingSheet: string;
  /** Normalized titles that mean scheduler or admin staff, not availability workers. */
  adminTitles: string[];
  /**
   * Normalized titles skipped outright. Null means none was ever saved on this
   * term, which is different from an empty list (saved, excludes nothing).
   */
  excludedTitles: string[] | null;
}

/**
 * "Gordon" is the unit Muster covers in the tracker workbook; "People Coming"
 * keeps the older PCPL workbooks importable.
 */
export const DEFAULT_ROSTER_CONFIG: RosterConfig = {
  sheetCandidates: ["Gordon", "People Coming"],
  leavingSheet: "People Leaving",
  adminTitles: [...ADMIN_TITLES],
  excludedTitles: null,
};

const cleanNames = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const names = value.filter((v): v is string => typeof v === "string").map((v) => v.trim());
  return [...new Set(names.filter(Boolean))];
};

const cleanTitles = (value: unknown): string[] | null => {
  const names = cleanNames(value);
  return names && [...new Set(names.map(normalizeTitle).filter(Boolean))];
};

/** Read a stored config. Anything missing or malformed takes its default. */
export function parseRosterConfig(raw: string | null): RosterConfig {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>;
    }
  } catch {
    // Unreadable JSON reads as "nothing stored".
  }

  const sheetCandidates = cleanNames(stored.sheetCandidates);
  const leavingSheet = typeof stored.leavingSheet === "string" ? stored.leavingSheet.trim() : "";
  return {
    // A list with no sheet in it would make every import fail, so it counts as unset.
    sheetCandidates: sheetCandidates?.length
      ? sheetCandidates
      : DEFAULT_ROSTER_CONFIG.sheetCandidates,
    leavingSheet: leavingSheet || DEFAULT_ROSTER_CONFIG.leavingSheet,
    adminTitles: cleanTitles(stored.adminTitles) ?? DEFAULT_ROSTER_CONFIG.adminTitles,
    excludedTitles: cleanTitles(stored.excludedTitles),
  };
}
