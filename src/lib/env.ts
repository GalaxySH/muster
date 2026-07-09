import { z } from "zod";
import { parseKey } from "@/lib/crypto/secretbox";
import { isDevLoginEnabled } from "@/lib/auth/policy";
import {
  DEV_AUTH_SECRET,
  DEV_ENCRYPTION_KEY,
  findProductionEnvIssues,
} from "@/lib/env-guard";

/**
 * Validated, typed access to environment variables.
 *
 * Import this only from server-side modules (DB, auth, email). Pure domain
 * logic under `src/lib/domain` must never depend on env so it stays trivially
 * testable.
 */

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(1).default(DEV_AUTH_SECRET),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("GDEC Scheduling <no-reply@re.hauge.rocks>"),
  ADMIN_EMAILS: z.string().default(""),
  // Base64 256-bit key for encrypting secrets at rest (the Drive refresh token).
  ENCRYPTION_KEY: z
    .string()
    .default(DEV_ENCRYPTION_KEY)
    .refine((v) => tryParseKey(v), {
      message: "must be a base64-encoded 256-bit key (`openssl rand -base64 32`)",
    }),
  // Destination Drive folder for evidence relay (a Shared Drive folder id; §12).
  DRIVE_FOLDER_ID: z.string().default(""),
  // Bearer token for the host-cron endpoints (the change-request digest). The
  // route refuses every request while this is unset, so the feature is opt-in.
  CRON_SECRET: z.string().default(""),
  // DEV ONLY: enable the no-OAuth dev-login bypass ("1"/"true"). Never honored
  // in production (see isDevLoginEnabled). Leave empty everywhere but local.
  DEV_LOGIN_ENABLED: z.string().default(""),
});

function tryParseKey(value: string): boolean {
  try {
    parseKey(value);
    return true;
  } catch {
    return false;
  }
}

function loadEnv() {
  // During `next build` (no runtime secrets present) validation is relaxed so
  // module evaluation doesn't fail; real values are required at runtime. Set
  // SKIP_ENV_VALIDATION=1 to force this manually.
  const skip =
    process.env.SKIP_ENV_VALIDATION === "1" || process.env.NEXT_PHASE === "phase-production-build";

  const source: Record<string, string | undefined> = { ...process.env };
  if (skip && !source.DATABASE_URL) {
    source.DATABASE_URL = "mysql://build:build@localhost:3306/build";
  }

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // Fail fast in production if any committed dev fallback is still in place
  // (env-guard.ts). Skipped during `next build`, like the rest of validation.
  if (!skip) {
    const prodIssues = findProductionEnvIssues(parsed.data, process.env.NODE_ENV);
    if (prodIssues.length > 0) {
      throw new Error(
        `Refusing to start with insecure production configuration:\n${prodIssues
          .map((i) => `  - ${i}`)
          .join("\n")}`,
      );
    }
  }

  return parsed.data;
}

export const env = loadEnv();

/** Parsed admin allowlist as a normalized lowercase set. */
export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** The encryption key as raw bytes, parsed once (for secrets at rest, §12). */
export const encryptionKey = parseKey(env.ENCRYPTION_KEY);

/** Whether the dev-login bypass is active (flag set AND not production). */
export const devLoginEnabled = isDevLoginEnabled(env.DEV_LOGIN_ENABLED, process.env.NODE_ENV);
