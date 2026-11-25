/**
 * Returning-student detection (PLAN §13): someone hired before the term's
 * new-hire cutoff. Anyone hired on or after it is a new hire this term; anyone
 * hired before it worked in an earlier one. The cutoff is the term's own
 * (`terms.new_hire_cutoff`, "YYYY-MM-DD"), so nothing here reads a clock.
 */
import { localDay } from "@/lib/domain/calendar-day";

/**
 * True when this hire date predates the term's cutoff (unknown date ⇒ not a
 * returner). Compared as calendar days, never as instants: the hire date is a
 * `date` column the driver hands back as local midnight, so its day comes off
 * `localDay` and the answer is the same in any server timezone.
 */
export function isReturningStudent(hiredOn: Date | null, cutoff: string): boolean {
  if (!hiredOn) return false;
  return localDay(hiredOn) < cutoff;
}
