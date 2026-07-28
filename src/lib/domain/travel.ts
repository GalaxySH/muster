/**
 * Travel-excusal cutoff rule (PLAN.md §5 #8, §7b, §8).
 *
 * Travel is excused only if its entry was created BEFORE the global
 * semester-start cutoff (9/1 by default; admin-configurable via app_settings,
 * see lib/settings.ts). What happens to a LATE entry is the policy below. The
 * cutoff is its own config value, independent of per-position form windows
 * (§13).
 */

/** True if a travel entry created at `createdAt` is excused under the cutoff. */
export function isTravelExcused(createdAt: Date, cutoff: Date): boolean {
  return createdAt.getTime() < cutoff.getTime();
}

export type LateTravelPolicy = "refuse" | "accept-and-flag";

/**
 * The DEFAULT late-travel policy (owner decision 2026-07-09): entries on/after
 * the cutoff are REFUSED outright: nothing is stored, so every stored entry is
 * excused by construction and the `travel_late` flag never raises. The
 * effective policy is admin-configurable at runtime (`getLateTravelPolicy` in
 * lib/settings.ts, toggled on /admin/groups); switching to "accept-and-flag"
 * restores the previous behavior end to end: late entries are stored with
 * `excused: false`, the "not excused (late)" badges render, and
 * finalizeSubmission raises `travel_late`.
 */
export const LATE_TRAVEL_POLICY: LateTravelPolicy = "refuse";

export type TravelDecision = { allowed: true; excused: boolean } | { allowed: false };

/**
 * Decide a travel entry created at `now` under `cutoff` and `policy`. Callers
 * pass the admin-configured policy (getLateTravelPolicy in lib/settings.ts);
 * there is deliberately no default, so a gate can never silently fall back to
 * "refuse" while the admin has late travel switched on.
 */
export function decideTravelSubmission(
  now: Date,
  cutoff: Date,
  policy: LateTravelPolicy,
): TravelDecision {
  if (isTravelExcused(now, cutoff)) return { allowed: true, excused: true };
  return policy === "refuse" ? { allowed: false } : { allowed: true, excused: false };
}

/**
 * The default semester-start cutoff: September 1, 00:00 US Central (06:00 UTC)
 * of the year in which the form is being filled. A v1 default; a global
 * config value can override this later (PLAN §13).
 */
export function defaultTravelCutoff(now: Date): Date {
  // Return September 1 00:00 Central Standard Time (CST = UTC-6).
  // To represent 00:00 CST in a UTC Date, add 6 hours (i.e. 06:00 UTC).
  return new Date(Date.UTC(now.getUTCFullYear(), 8, 1, 6, 0, 0)); // month 8 = September
}
