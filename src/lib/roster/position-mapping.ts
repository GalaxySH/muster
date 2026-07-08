/**
 * Roster "Position Title" → Muster position mapping (PLAN.md §16.2).
 *
 * Keys are normalized titles (lowercased, trimmed, whitespace-collapsed, see
 * normalizeTitle). Editable config: when the roster introduces a new title,
 * add it here. Titles not found map to a null position (the student self-reports
 * during onboarding) and are reported by the importer.
 */

/** Normalize a raw title for stable lookup (handles case, padding, stray newlines). */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Title → Muster position id. */
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
