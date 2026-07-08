/**
 * Production configuration guard (pure, no env access, TDD).
 *
 * `env.ts` runs these checks at startup and refuses to boot in production
 * when an insecure dev fallback is still in place, so a misconfigured deploy
 * fails fast and loudly instead of silently running with publicly-known
 * secrets (the dev defaults are committed to this repo).
 */

/** Fixed dev fallbacks, fine locally, never in production. */
export const DEV_AUTH_SECRET = "dev-insecure-secret";
export const DEV_ENCRYPTION_KEY = "bXVzdGVyLWRldi1pbnNlY3VyZS1lbmNyeXB0aW9uLTA=";

export interface ProductionGuardValues {
  AUTH_SECRET: string;
  ENCRYPTION_KEY: string;
  DEV_LOGIN_ENABLED: string;
}

/**
 * Problems that must block a production boot. Empty outside production so
 * local dev and tests keep their zero-setup defaults.
 */
export function findProductionEnvIssues(
  values: ProductionGuardValues,
  nodeEnv: string | undefined,
): string[] {
  if (nodeEnv !== "production") return [];

  const issues: string[] = [];
  if (values.AUTH_SECRET === DEV_AUTH_SECRET) {
    issues.push(
      "AUTH_SECRET is the insecure dev default. Set a real value (`openssl rand -base64 32`)",
    );
  }
  if (values.ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) {
    issues.push(
      "ENCRYPTION_KEY is the insecure dev default. Set a real value (`openssl rand -base64 32`)",
    );
  }
  // isDevLoginEnabled already refuses the bypass in production; rejecting the
  // flag here too keeps a leftover local setting from riding into a prod env.
  if (values.DEV_LOGIN_ENABLED !== "") {
    issues.push("DEV_LOGIN_ENABLED is set. Remove the dev-login flag from production env");
  }
  return issues;
}
