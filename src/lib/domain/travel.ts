/**
 * Travel-excusal cutoff rule (PLAN.md §5 #8, §7b, §8).
 *
 * Travel is excused only if its entry was created BEFORE the global
 * semester-start cutoff (9/1, all positions). Entries created on or after the
 * cutoff are accepted but flagged "not excused (late)". The cutoff is its own
 * config value, independent of per-position form windows (§13).
 */

/** True if a travel entry created at `createdAt` is excused under the cutoff. */
export function isTravelExcused(createdAt: Date, cutoff: Date): boolean {
  return createdAt.getTime() < cutoff.getTime();
}

/**
 * The default semester-start cutoff: September 1 (00:00 UTC) of the year in
 * which the form is being filled. A v1 default — a global config value can
 * override this later (PLAN §13).
 */
export function defaultTravelCutoff(now: Date): Date {
  // Return September 1 00:00 Central Standard Time (CST = UTC-6).
  // To represent 00:00 CST in a UTC Date, add 6 hours (i.e. 06:00 UTC).
  return new Date(Date.UTC(now.getUTCFullYear(), 8, 1, 6, 0, 0)); // month 8 = September
}
