import { z } from "zod";

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
  AUTH_SECRET: z.string().min(1).default("dev-insecure-secret"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("GDEC Scheduling <sched@hauge.rocks>"),
  ADMIN_EMAILS: z.string().default(""),
});

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
  return parsed.data;
}

export const env = loadEnv();

/** Parsed admin allowlist as a normalized lowercase set. */
export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
