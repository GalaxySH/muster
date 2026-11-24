/**
 * Returning-student detection (PLAN §13): someone hired before the term's
 * new-hire cutoff. Anyone hired on or after it is a new hire this term; anyone
 * hired before it worked in an earlier one. The cutoff is the term's own
 * (`terms.new_hire_cutoff`, "YYYY-MM-DD"), so nothing here reads a clock.
 */

/** The cutoff as an instant: UTC midnight, the same way hire dates are stored. */
export function newHireCutoff(cutoff: string): Date {
  return new Date(`${cutoff}T00:00:00Z`);
}

/** True when this hire date predates the term's cutoff (unknown date ⇒ not a returner). */
export function isReturningStudent(hiredOn: Date | null, cutoff: string): boolean {
  if (!hiredOn) return false;
  return hiredOn.getTime() < newHireCutoff(cutoff).getTime();
}
