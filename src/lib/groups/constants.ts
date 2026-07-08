/**
 * Stable identity of the seeded "New Student" group (PLAN.md §13). The seed
 * creates it with a fixed id and marks it default when no other group holds the
 * flag; *which* group catches ungrouped/self-added students is the `isDefault`
 * flag (re-pointable via setDefaultGroup), not this id. Pure constants — safe
 * to import anywhere (seed CLI, server modules).
 */
export const DEFAULT_GROUP_ID = "default";
export const DEFAULT_GROUP_NAME = "New Student";
