/**
 * Run-health classification for the change-request digest. The daily run is
 * the in-app scheduler (scheduler.ts), and every run stamps
 * `change_digest_last_run` (including no-op runs), so the stamp's age says
 * whether the scheduler is actually alive. Pure so the email-settings page
 * and the admin hub share one definition of "the digest looks dead".
 */

/** Past this age, the digest scheduler looks dead, not quiet (runs are daily). */
export const DIGEST_STALE_HOURS = 36;
/**
 * A missing first run within this long after boot is normal startup, not a
 * broken scheduler: the boot tick stamps within seconds when the DB is up,
 * and within a few tick intervals otherwise.
 */
export const DIGEST_STARTUP_GRACE_MS = 15 * 60 * 1000;

export type DigestRunHealth =
  /** The scheduler does not run in this environment (dev without the flag). */
  | "disabled"
  /** No run recorded yet, but the process just booted; expected shortly. */
  | "starting"
  /** No run recorded even though the process has been up past the grace. */
  | "never-ran"
  /** The last recorded run is older than DIGEST_STALE_HOURS. */
  | "stale"
  | "ok";

export function digestRunHealth(input: {
  schedulerEnabled: boolean;
  lastRunAt: Date | null;
  /** This server process's uptime in ms (process.uptime() * 1000). */
  uptimeMs: number;
  now: Date;
}): DigestRunHealth {
  if (!input.schedulerEnabled) return "disabled";
  if (!input.lastRunAt) {
    return input.uptimeMs < DIGEST_STARTUP_GRACE_MS ? "starting" : "never-ran";
  }
  const age = input.now.getTime() - input.lastRunAt.getTime();
  return age > DIGEST_STALE_HOURS * 60 * 60 * 1000 ? "stale" : "ok";
}
