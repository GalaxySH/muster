/**
 * Dev-only test accounts (the /dev-login manager). Throwaway students are placed
 * in a dedicated, always-open group so they can walk the whole student flow, and
 * so the manager can list/delete exactly the accounts it created (never a real
 * roster student). Everything here is gated by DEV_LOGIN_ENABLED — never prod.
 */
export const DEV_GROUP_ID = "dev-test";
export const DEV_GROUP_NAME = "Dev test accounts";

/** Always-open window bounds for the dev group. */
export const DEV_GROUP_OPENS_AT = new Date("2000-01-01T00:00:00Z");
export const DEV_GROUP_CLOSES_AT = new Date("2100-01-01T00:00:00Z");
