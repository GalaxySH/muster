/**
 * Pure rules about a term's own details (docs/semester-domains-plan.md §2.1):
 * what an admin may save on the Semester page, and which year a bare month
 * and day belongs to. No I/O.
 */

import { isValidCloseRequirement, MAX_CLOSE_REQUIREMENT } from "./close-claims";

/** The fields an admin edits on the Semester page. Dates are "YYYY-MM-DD". */
export interface TermDetails {
  name: string;
  startsOn: string;
  endsOn: string;
  newHireCutoff: string;
  scheduleNote: string;
  /** How many weekend closes a new Shift Lead starts on (PLAN §18a). */
  closeRequirement: number;
}

export const TERM_NAME_MAX = 64;
export const SCHEDULE_NOTE_MAX = 500;

const isIsoDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Trim the text fields. Dates pass through untouched for the check below. */
export function cleanTermDetails(input: TermDetails): TermDetails {
  return {
    name: input.name.trim().replace(/\s+/g, " "),
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    newHireCutoff: input.newHireCutoff,
    scheduleNote: input.scheduleNote.trim(),
    closeRequirement: input.closeRequirement,
  };
}

/** Check cleaned details. Returns the error to show, or null. */
export function validateTermDetails(details: TermDetails): string | null {
  if (!details.name) return "Give the semester a name.";
  if (details.name.length > TERM_NAME_MAX) {
    return `Keep the name under ${TERM_NAME_MAX} characters.`;
  }
  if (!isIsoDate(details.startsOn)) return "Pick a start date.";
  if (!isIsoDate(details.endsOn)) return "Pick an end date.";
  if (details.endsOn <= details.startsOn) return "The end date must be after the start date.";
  if (!isIsoDate(details.newHireCutoff)) return "Pick a new hire date.";
  if (details.newHireCutoff > details.endsOn) {
    return "The new hire date can't be after the semester ends.";
  }
  if (!details.scheduleNote) return "Write the schedule note students see when they finish.";
  if (details.scheduleNote.length > SCHEDULE_NOTE_MAX) {
    return `Keep the schedule note under ${SCHEDULE_NOTE_MAX} characters.`;
  }
  if (!isValidCloseRequirement(details.closeRequirement)) {
    return `Closes per Shift Lead must be a whole number from 0 to ${MAX_CLOSE_REQUIREMENT}.`;
  }
  return null;
}

/**
 * The year a bare month and day belongs to, for a term starting on `startsOn`:
 * the first time that date comes round on or after the start of the month
 * before the term begins. For a September 2, 2026 start that puts August
 * through December in 2026 and January through July in 2027.
 */
export function termYearFor(month: number, day: number, startsOn: string): number {
  const start = new Date(`${startsOn}T00:00:00Z`);
  const anchor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const year = anchor.getUTCFullYear();
  const sameYear = month * 100 + day >= (anchor.getUTCMonth() + 1) * 100 + anchor.getUTCDate();
  return sameYear ? year : year + 1;
}

/** Other terms' names that appear in a piece of text, for the stale-template warning. */
export function termNamesIn(text: string, otherTermNames: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return otherTermNames.filter((name) => name.trim() && haystack.includes(name.toLowerCase()));
}
