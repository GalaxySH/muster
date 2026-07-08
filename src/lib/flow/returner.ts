/**
 * Returning-student detection for the /me welcome-back greeting (PLAN §4.1, §13).
 *
 * A "returner" is someone hired before the current hiring cycle began. Cycles run
 * with the academic year, so the boundary is June 1: anyone hired on/after the most
 * recent June 1 is a new hire for this cycle, anyone hired before it worked in a
 * prior cycle. Pure so it's testable with a fixed `now`.
 */

/** June 1 (UTC midnight) of the current cycle: the most recent June 1 on or before `now`. */
export function returnerCutoff(now: Date): Date {
  const june = 5; // 0-indexed
  const year = now.getUTCMonth() >= june ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, june, 1));
}

/** True when this hire date predates the current cycle (unknown date ⇒ not a returner). */
export function isReturningStudent(hiredOn: Date | null, now: Date): boolean {
  if (!hiredOn) return false;
  return hiredOn.getTime() < returnerCutoff(now).getTime();
}
