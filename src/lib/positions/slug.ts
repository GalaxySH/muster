/**
 * Slug helper for admin-created position ids (roadmap 3.3). Pure so the
 * server actions and tests share one implementation. Ids are opaque handles;
 * the slug just keeps them readable in the DB and in block ids.
 */

/** positions.id column width (schema.ts). */
export const POSITION_ID_MAX = 64;
/** positions.name column width (schema.ts). */
export const POSITION_NAME_MAX = 128;

/**
 * Kebab-case id from a position name: lowercased, diacritics stripped, every
 * non-alphanumeric run collapsed to one dash, trimmed of dashes, capped at
 * POSITION_ID_MAX. Returns "" when nothing usable remains.
 */
export function slugifyPositionId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, POSITION_ID_MAX)
    .replace(/-+$/, "");
}
