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

/**
 * The tracker's header text for each column the import reads. A blank name
 * means "find it the built-in way" (see extractRosterRows), which is what
 * every term starts with; a name is only needed when a header is reworded
 * past what the built-in matching recognizes.
 */
export interface RosterColumns {
  name: string;
  email: string;
  title: string;
  international: string;
  startDate: string;
}

export const AUTOMATIC_COLUMNS: RosterColumns = {
  name: "",
  email: "",
  title: "",
  international: "",
  startDate: "",
};

/** What the roster settings panel edits: everything but the excluded titles. */
export type RosterReading = Omit<RosterConfig, "excludedTitles">;

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
  /** Header names for columns the built-in matching can't find. */
  columns: RosterColumns;
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
  columns: AUTOMATIC_COLUMNS,
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

const NAME_MAX = 100;

const cleanColumns = (value: unknown): RosterColumns => {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (k: keyof RosterColumns) => {
    const v = stored[k];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    name: text("name"),
    email: text("email"),
    title: text("title"),
    international: text("international"),
    startDate: text("startDate"),
  };
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
    columns: cleanColumns(stored.columns),
  };
}

/** The settings panel's fields: lists are typed one per line. */
export interface RosterReadingInput {
  sheetCandidates: string;
  leavingSheet: string;
  adminTitles: string;
  columns: RosterColumns;
}

/**
 * Tidy what the settings panel sent into a storable reading. Blank sheet names
 * fall back to the defaults, since an import with no sheet to read can't run.
 */
export function cleanRosterReading(input: RosterReadingInput): RosterReading {
  const config = parseRosterConfig(
    JSON.stringify({
      sheetCandidates: String(input.sheetCandidates ?? "").split("\n"),
      leavingSheet: String(input.leavingSheet ?? ""),
      adminTitles: String(input.adminTitles ?? "").split("\n"),
      columns: input.columns,
    }),
  );
  return {
    sheetCandidates: config.sheetCandidates,
    leavingSheet: config.leavingSheet,
    adminTitles: config.adminTitles,
    columns: config.columns,
  };
}

/** Check a cleaned reading. Returns the error to show, or null. */
export function validateRosterReading(reading: RosterReading): string | null {
  const columnNames = Object.values(reading.columns);
  const names = [...reading.sheetCandidates, reading.leavingSheet, ...columnNames];
  if (names.some((n) => n.length > NAME_MAX)) return `Keep each name under ${NAME_MAX} characters.`;
  if (reading.sheetCandidates.length > 10) return "List at most 10 sheets.";
  if (reading.adminTitles.length > 50) return "List at most 50 admin titles.";
  if (reading.adminTitles.some((t) => t.length > 200)) {
    return "Keep each title under 200 characters.";
  }
  const set = columnNames.map(normalizeTitle).filter(Boolean);
  if (new Set(set).size !== set.length) return "Two columns can't have the same name.";
  return null;
}
