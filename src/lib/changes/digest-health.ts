/**
 * Cron-health classification for the change-request digest. The digest has no
 * in-process scheduler: it only runs when host cron posts to
 * /api/cron/change-digest (docs/deploy.md §7), so the on/off toggle alone
 * cannot say whether a digest will actually go out. Every run stamps
 * `change_digest_last_run` (including no-op runs), which is what makes the
 * failure shapes below distinguishable. Pure so the email-settings page and
 * the admin hub share one definition of "the cron looks dead".
 */

/** Past this age, the digest cron looks dead, not quiet (runs are daily). */
export const DIGEST_STALE_HOURS = 36;

export type DigestCronHealth =
  /** CRON_SECRET is unset, so the endpoint refuses every run. */
  | "no-secret"
  /** The secret is set but no run has ever been recorded. */
  | "never-ran"
  /** The last recorded run is older than DIGEST_STALE_HOURS. */
  | "stale"
  | "ok";

export function digestCronHealth(input: {
  secretConfigured: boolean;
  lastRunAt: Date | null;
  now: Date;
}): DigestCronHealth {
  if (!input.secretConfigured) return "no-secret";
  if (!input.lastRunAt) return "never-ran";
  const age = input.now.getTime() - input.lastRunAt.getTime();
  return age > DIGEST_STALE_HOURS * 60 * 60 * 1000 ? "stale" : "ok";
}
