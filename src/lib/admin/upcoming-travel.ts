/**
 * Pure grouping for the upcoming-travel admin tab (roadmap 2.3).
 *
 * Buckets current + soon travel (now through +N weeks, default 3) into calendar
 * weeks so the scheduler can see, week by week, who is away. Weeks are anchored on
 * Sunday to match the scheduling week (PLAN §7). A range that straddles a week
 * boundary appears under each week it touches. No I/O; the page joins the entries.
 */

/** The minimal shape the bucketing reads; callers pass richer rows and get them back. */
export interface TravelWindowEntry {
  startDate: string; // ISO yyyy-mm-dd (inclusive)
  endDate: string; // ISO yyyy-mm-dd (inclusive)
}

export interface TravelWeek<T> {
  /** ISO yyyy-mm-dd of the week's Sunday. */
  weekStart: string;
  entries: T[];
}

const DAY_MS = 86_400_000;

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** The Sunday (UTC) on or before `d`. */
function weekStartSunday(d: Date): Date {
  return addDays(d, -d.getUTCDay());
}

/**
 * Travel overlapping [today, today + weeks·7 days], grouped by Sunday-started
 * week (only non-empty weeks, in date order). Within a week, entries keep start
 * order then the caller's input order (so pre-sorting by name breaks ties).
 */
export function upcomingTravel<T extends TravelWindowEntry>(
  entries: T[],
  now: Date,
  weeks = 3,
): TravelWeek<T>[] {
  const today = utcDate(isoDay(now));
  const horizonEnd = addDays(today, weeks * 7);

  const inWindow = entries.filter(
    (e) => utcDate(e.endDate) >= today && utcDate(e.startDate) <= horizonEnd,
  );
  const byStart = [...inWindow].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const result: TravelWeek<T>[] = [];
  for (let ws = weekStartSunday(today); ws <= horizonEnd; ws = addDays(ws, 7)) {
    const weekEnd = addDays(ws, 6);
    const bucket = byStart.filter(
      (e) => utcDate(e.startDate) <= weekEnd && utcDate(e.endDate) >= ws,
    );
    if (bucket.length) result.push({ weekStart: isoDay(ws), entries: bucket });
  }
  return result;
}
