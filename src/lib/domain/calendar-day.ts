/**
 * The calendar day of a stored date, read in the frame it was built in.
 *
 * `mysql2` materializes a `date` column as `new Date(y, m - 1, d)`: midnight
 * LOCAL time. Reading that back through `toISOString` reads the UTC frame
 * instead and lands a day early on any host east of UTC, so the day has to come
 * off the local getters. Three call sites had each written that out for
 * themselves, which is three chances to get it wrong; it is one function now.
 *
 * `matchesStarted` sits here too because the comparison is the same idea: the
 * response dashboard and the group-assignment picker both filter the same
 * `students.hired_on` against the same three options, and neither of them owns
 * the rule.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** The `yyyy-mm-dd` of a Date read in the local frame. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** How a start-date filter compares against the roster hire date. */
export type StartedMode = "before" | "after" | "on";

/**
 * Calendar-day comparison against the roster start date (ISO strings sort).
 * A student with no hire date matches nothing: the filter asks a question
 * about a date they do not have.
 */
export function matchesStarted(
  hiredOn: Date | null,
  started: { mode: StartedMode; date: string },
): boolean {
  if (!hiredOn) return false;
  const day = localDay(hiredOn);
  switch (started.mode) {
    case "before":
      return day < started.date;
    case "after":
      return day > started.date;
    case "on":
      return day === started.date;
  }
}
