/**
 * Roster "Position Title" → Muster position mapping (PLAN.md §16.2).
 *
 * Keys are normalized titles (lowercased, trimmed, whitespace-collapsed, see
 * normalizeTitle). TITLE_TO_POSITION is only the initial seed fixture for the
 * `roster_title_mappings` table: `db:seed` inserts it once when the table is
 * empty, and the importer reads the stored map from the DB. New titles are
 * resolved by admins on /admin/positions, not by editing this file.
 */

import { resolveAlias, type AliasRow } from "@/lib/domain/position-alias";

/**
 * Normalize a raw title for stable lookup: handles case, padding, stray
 * newlines, and accents, so "Retail and Café Team Member" matches whether the
 * export encoded the accent or not. Header cells are normalized with this too
 * (same job, same rules) when the parse layer locates columns.
 */
export function normalizeTitle(title: string): string {
  return title.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** A stored roster_title_mappings row. */
export interface TitleMappingRow {
  title: string;
  positionId: string;
}

/**
 * The effective normalized-title to canonical-position-id map the importer
 * feeds into parseRoster: each stored mapping resolves through the alias
 * chain, and a mapping whose resolved position row no longer exists counts
 * as unmapped (its title surfaces as a ghost again).
 */
export function buildEffectiveTitleMap(
  mappings: readonly TitleMappingRow[],
  positionRows: readonly AliasRow[],
): Map<string, string> {
  const known = new Set(positionRows.map((p) => p.id));
  const map = new Map<string, string>();
  for (const m of mappings) {
    const resolved = resolveAlias(m.positionId, positionRows);
    if (known.has(resolved)) map.set(normalizeTitle(m.title), resolved);
  }
  return map;
}

/** Title → Muster position id. Initial fixture only; the DB map is authoritative. */
export const TITLE_TO_POSITION: Readonly<Record<string, string>> = {
  "culinary assistant": "culinary-assistant",
  "student shift lead": "shift-lead",
  dishwasher: "dishwasher",
  "student stocker": "stocker",
  cashier: "cashier",
  "cashier (culinary assistant in sea)": "cashier",
  // No standalone "Barista" titles appear; cafe team members are the baristas.
  // Keys are accent-stripped by normalizeTitle, so "Café" matches "cafe".
  "southeast cafe team member": "barista",
  "retail and cafe team member": "barista",
};

/** Titles that designate scheduler/admin staff, not availability workers. */
export const ADMIN_TITLES: ReadonlySet<string> = new Set([
  "office student supervisor",
  "head student supervisor",
]);

/**
 * Titles to exclude from the import entirely (neither student nor admin).
 * Initial default only: once an admin saves the excluded-titles setting on
 * /admin/roster, the stored list is authoritative (see effectiveExcludedTitles).
 */
export const SKIP_TITLES: ReadonlySet<string> = new Set([
  // The tracker spells it "Advisory"; older PCPL workbooks say "Advisor".
  "dining advisory board member (dab)",
  "dining advisor board member (dab)",
]);

/**
 * app_settings key for the admin-edited excluded titles, stored one per line.
 * Lives here (not settings.ts, which is server-only) so the CLI-safe importer
 * can read the same setting through its own db handle.
 */
export const SETTING_EXCLUDED_ROSTER_TITLES = "excluded_roster_titles";

/**
 * Normalize a one-per-line title list: trim, lowercase, collapse whitespace,
 * drop blank lines, de-duplicate. Shared by the two admin-edited title lists,
 * the excluded titles on /admin/roster and a position's roster titles on
 * /admin/positions, for both storing and parsing back.
 */
export function normalizeTitleList(raw: string): string[] {
  const titles = new Set<string>();
  for (const line of raw.split("\n")) {
    const title = normalizeTitle(line);
    if (title) titles.add(title);
  }
  return [...titles];
}

/**
 * The effective excluded-title set parseRoster compares against: the stored
 * setting when present (an explicitly saved empty list excludes nothing),
 * else the SKIP_TITLES fixture.
 */
export function effectiveExcludedTitles(raw: string | null): ReadonlySet<string> {
  return raw === null ? SKIP_TITLES : new Set(normalizeTitleList(raw));
}

/** What an edited roster-title list changes, against what is stored. */
export interface TitleListDiff {
  /** The normalized list to store. */
  titles: string[];
  /** Titles the position did not claim before: their students move to it. */
  added: string[];
  /** Titles the position gives up: later imports stop steering them to it. */
  removed: string[];
}

/**
 * Diff an edited one-per-line title list against the stored titles. Both
 * sides normalize first, so re-casing or re-spacing a title is not a change.
 */
export function diffTitleList(saved: readonly string[], raw: string): TitleListDiff {
  const titles = normalizeTitleList(raw);
  const before = new Set(saved.map((t) => normalizeTitle(t)));
  const after = new Set(titles);
  return {
    titles,
    added: titles.filter((t) => !before.has(t)),
    removed: [...before].filter((t) => !after.has(t)).sort(),
  };
}
