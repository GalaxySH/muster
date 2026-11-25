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

/**
 * The term a request works in (docs/semester-domains-plan.md §2.9). A selection
 * counts only for an admin and only when it names a real term; everyone else,
 * and every other case, gets the current term.
 */
export function chooseWorkingTerm(input: {
  current: string;
  selected: string | null;
  isAdmin: boolean;
  selectedExists: boolean;
}): string {
  const { current, selected, isAdmin, selectedExists } = input;
  return selected && isAdmin && selectedExists ? selected : current;
}

/**
 * The app_settings key for something one term owns: its Drive folder, its
 * proofs folder, each of its sheets (docs/semester-domains-plan.md §2.6).
 */
export const termSettingKey = (base: string, termId: string): string => `${base}:${termId}`;

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

/** Terms' ids are slugs of at most this many characters (the column's width). */
export const TERM_ID_MAX = 32;

/**
 * The id for a new term: a slug of its name ("Spring 2027" gives
 * "spring-2027"), with a number added when another term already has it. The id
 * is fixed from then on, so renaming a term never moves its rows.
 */
export function termSlug(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "term";
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const id = base.slice(0, TERM_ID_MAX - suffix.length).replace(/-+$/, "") + suffix;
    if (!used.has(id)) return id;
  }
}

/** "YYYY-MM-DD" moved by whole months, clamped to the last day of a shorter month. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

/** How many months before the first day someone must be hired to count as returning. */
const NEW_HIRE_MONTHS_BEFORE_START = 3;

export const DEFAULT_SCHEDULE_NOTE =
  "Expect to see your schedule a week before the semester starts.";

/**
 * What a new term starts with, worked out from its first day. Each is only a
 * starting value the admin can change on the Semester page afterwards. The
 * travel cutoff has its own rule in domain/travel.ts.
 */
export function newTermDefaults(startsOn: string): { newHireCutoff: string; scheduleNote: string } {
  return {
    newHireCutoff: addMonths(startsOn, -NEW_HIRE_MONTHS_BEFORE_START),
    scheduleNote: DEFAULT_SCHEDULE_NOTE,
  };
}

/** What an admin fills in to start a new semester. Dates are "YYYY-MM-DD". */
export interface NewTermInput {
  name: string;
  startsOn: string;
  endsOn: string;
  /** The name typed again, as the confirmation. */
  confirmName: string;
}

/** Check a cleaned new-semester request. Returns the error to show, or null. */
export function validateNewTerm(input: NewTermInput): string | null {
  if (!input.name) return "Give the semester a name.";
  if (input.name.length > TERM_NAME_MAX) return `Keep the name under ${TERM_NAME_MAX} characters.`;
  if (!isIsoDate(input.startsOn)) return "Pick a start date.";
  if (!isIsoDate(input.endsOn)) return "Pick an end date.";
  if (input.endsOn <= input.startsOn) return "The end date must be after the start date.";
  if (input.confirmName.trim().replace(/\s+/g, " ") !== input.name) {
    return "Type the new semester's name to confirm.";
  }
  return null;
}
