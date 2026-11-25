/**
 * Travel-excusal cutoff rule (PLAN.md §5 #8, §7b, §8).
 *
 * Travel is excused only if its entry was created BEFORE the term's cutoff
 * (the day before the term starts by default; the admin can move it, see
 * lib/settings.ts). What happens to a LATE entry is the policy below. The
 * cutoff is its own config value, independent of per-position form windows
 * (§13).
 */
import { APP_TIME_ZONE, MONTH_LABELS } from "./time";

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
 * lib/settings.ts, toggled on /admin/terms); switching to "accept-and-flag"
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
 * A term's default travel cutoff: 00:00 US Central on the day before it starts
 * (`startsOn` is "YYYY-MM-DD"). A semester starting September 2 gives the
 * September 1 cutoff the form launched with. The admin can set any other
 * instant on the term; this is what a term starts with and what Reset restores.
 */
export function defaultTravelCutoff(startsOn: string): Date {
  // 00:00 Central Standard Time (UTC-6) as a UTC instant is 06:00 UTC. The
  // offset is fixed rather than daylight-aware, as it always has been here.
  const start = new Date(`${startsOn}T06:00:00Z`);
  return new Date(start.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * How a stored travel entry stands. Unexcused used to mean late, and still does
 * whenever there is proof: students can't save an entry without one. An
 * unexcused entry with NO proof is one an admin recorded that way, which the
 * Google Form import does for a range that came without proof
 * (docs/form-paste.md). That one isn't late, so it reads differently and never
 * counts toward `travel_late`.
 */
export type TravelStanding = "excused" | "late" | "unproven";

export function travelStanding(entry: {
  excused: boolean;
  proofFileId: string | null;
}): TravelStanding {
  if (entry.excused) return "excused";
  return entry.proofFileId ? "late" : "unproven";
}

/** The badge text for each standing, shared by the student and admin views. */
export const TRAVEL_STANDING_LABEL: Record<TravelStanding, string> = {
  excused: "excused",
  late: "not excused (late)",
  unproven: "not excused (no proof)",
};

/** The cutoff as a student reads it, e.g. "Jan 15, 2027": the day it falls on in Madison. */
export function formatCutoffDate(cutoff: Date): string {
  return cutoff.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

/**
 * "Nov 25 to Nov 29, 2026" from two stored "YYYY-MM-DD" days. Read off the
 * strings, never through a Date, so no timezone can move a day. The year is
 * said once when both days share it, and a one-day trip is a single date.
 * Anything that isn't a stored day is shown as it is.
 */
export function formatTravelRange(startIso: string, endIso: string): string {
  const parse = (iso: string) => {
    const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) ?? [];
    const month = MONTH_LABELS[Number(m) - 1];
    return month ? { year: y, day: `${month} ${Number(d)}` } : null;
  };
  const start = parse(startIso);
  const end = parse(endIso);
  if (!start || !end) return `${startIso} to ${endIso}`;
  if (startIso === endIso) return `${end.day}, ${end.year}`;
  return start.year === end.year
    ? `${start.day} to ${end.day}, ${end.year}`
    : `${start.day}, ${start.year} to ${end.day}, ${end.year}`;
}
