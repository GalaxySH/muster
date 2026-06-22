/**
 * Stable identity of the default "New Student" group (PLAN.md §13). Seeded with
 * a fixed id so resolution + the assignment sweep can find it; it is the single
 * non-deletable group that ungrouped/self-added students fall into when the
 * default-assignment toggle is on. Pure constants — safe to import anywhere
 * (seed CLI, server modules).
 */
export const DEFAULT_GROUP_ID = "default";
export const DEFAULT_GROUP_NAME = "New Student";
