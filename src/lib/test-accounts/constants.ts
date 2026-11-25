/**
 * Test accounts (the /admin/test-users manager). Throwaway students are placed
 * in a dedicated group so they can walk the whole student flow, and so the
 * manager can list/delete exactly the accounts it created (never a real roster
 * student). They stay off-roster, so they never appear in the response list,
 * export, sheet, or non-response tracking.
 */

// Kept as "dev-test" (the manager's dev-only predecessor) so existing dev-DB
// accounts aren't stranded under an orphaned group id.
export const TEST_GROUP_ID = "dev-test";
/**
 * The id a term's test-accounts group is created with. The first term's group
 * predates terms and keeps the id above; it is always found by its kind, never
 * by id, so the two never have to agree.
 */
export const testGroupIdFor = (termId: string): string => `test-${termId}`;
export const TEST_GROUP_NAME = "Test accounts";

/**
 * Initial window bounds for the test group, wide open, so test accounts work
 * out of the box. Applied only when the group is first created; admins can
 * edit the window on /admin/groups afterwards like any other group.
 */
export const TEST_GROUP_OPENS_AT = new Date("2000-01-01T00:00:00Z");
export const TEST_GROUP_CLOSES_AT = new Date("2100-01-01T00:00:00Z");
