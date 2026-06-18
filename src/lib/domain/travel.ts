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
