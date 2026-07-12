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

/** Normalize a raw title for stable lookup (handles case, padding, stray newlines). */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
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
  "southeast cafe team member": "barista",
};

/** Titles that designate scheduler/admin staff, not availability workers. */
export const ADMIN_TITLES: ReadonlySet<string> = new Set([
  "office student supervisor",
  "head student supervisor",
]);

/** Titles to exclude from the import entirely (neither student nor admin). */
export const SKIP_TITLES: ReadonlySet<string> = new Set(["dining advisor board member (dab)"]);
