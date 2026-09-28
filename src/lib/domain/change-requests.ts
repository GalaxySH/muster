/**
 * Pure rules for student schedule change requests (roadmap 3.1).
 *
 * A change request refers to the student's actual W2W schedule, which Muster
 * doesn't model, so the day is the only structured field; the shift time(s)
 * and the ask are the student's own words. The rate cap is a modest rolling
 * 24-hour limit on created requests (withdrawing doesn't refund it).
 */
import { formatSpan } from "./time";
import { ALL_DAYS, DAY_LABEL, dayTypeOf, type Day, type ShiftBlock } from "./types";

export const CHANGE_REQUEST_DAILY_CAP = 3;
export const CHANGE_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_SHIFT_TEXT_LENGTH = 200;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_CHANGE_REQUEST_FILES = 3;

/** The day a request names: one day of the week, or several. */
export type ChangeRequestDay = Day | "multiple";
export const CHANGE_REQUEST_DAYS: readonly ChangeRequestDay[] = [...ALL_DAYS, "multiple"];

/** The form's day choices, "Multiple" first since it is the default. */
export const CHANGE_REQUEST_DAY_OPTIONS: readonly { value: ChangeRequestDay; label: string }[] = [
  { value: "multiple", label: "Multiple" },
  { value: "sun", label: "Sunday" },
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
];

/** Short label for lists and the digest ("Mon", or "Multiple days"). */
export function changeRequestDayLabel(day: ChangeRequestDay): string {
  return day === "multiple" ? "Multiple days" : DAY_LABEL[day];
}

/** The part of a shift block the quick-insert shift times need. */
export type ShiftTimeBlock = Pick<ShiftBlock, "dayType" | "start" | "end">;

/**
 * The shift times to offer as quick inserts for a request: the position's
 * blocks for the chosen day's type (every block for "multiple"), one entry per
 * distinct span, earliest first, in the app's usual "4p to 8p" notation.
 * Callers pass live blocks only.
 */
export function shiftTimeOptions(
  blocks: readonly ShiftTimeBlock[],
  day: ChangeRequestDay,
): string[] {
  const dayType = day === "multiple" ? null : dayTypeOf(day);
  const spans = new Map<string, { start: number; end: number }>();
  for (const b of blocks) {
    if (dayType && b.dayType !== dayType) continue;
    spans.set(`${b.start}-${b.end}`, { start: b.start, end: b.end });
  }
  return [...spans.values()]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s) => formatSpan(s.start, s.end));
}

/**
 * Add a quick-insert shift time to the free-text box: fill it when empty,
 * otherwise append after a comma. A time already listed leaves the text as is.
 */
export function insertShiftTime(current: string, time: string): string {
  const kept = current.replace(/[\s,]+$/, "");
  if (!kept.trim()) return time;
  if (kept.split(",").some((part) => part.trim() === time)) return current;
  return `${kept}, ${time}`;
}

export interface ChangeRequestValue {
  day: ChangeRequestDay;
  shiftText: string;
  comment: string;
  /** True = a permanent schedule change; false = a one-time change. */
  permanent: boolean;
}

export type ChangeRequestValidation =
  | { ok: true; value: ChangeRequestValue }
  | { ok: false; error: string };

export function validateChangeRequest(input: {
  day: string;
  shiftText: string;
  comment: string;
  permanent: boolean;
}): ChangeRequestValidation {
  if (!(CHANGE_REQUEST_DAYS as readonly string[]).includes(input.day)) {
    return { ok: false, error: "Pick the day of the shift." };
  }
  const shiftText = input.shiftText.trim();
  if (!shiftText) return { ok: false, error: "Enter the shift time, e.g. 2p to 5p." };
  if (shiftText.length > MAX_SHIFT_TEXT_LENGTH) {
    return { ok: false, error: `Keep the shift time under ${MAX_SHIFT_TEXT_LENGTH} characters.` };
  }
  const comment = input.comment.trim();
  if (!comment) return { ok: false, error: "Describe the change you need." };
  if (comment.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `Keep the comment under ${MAX_COMMENT_LENGTH} characters.` };
  }
  return { ok: true, value: { day: input.day as ChangeRequestDay, shiftText, comment, permanent: input.permanent } };
}

export interface ChangeRequestRate {
  allowed: boolean;
  /** When the next request becomes allowed (only set while blocked). */
  nextAllowedAt: Date | null;
}

/**
 * Rolling-window rate cap: at most CHANGE_REQUEST_DAILY_CAP requests created
 * in the last 24 hours. `createdAts` is the student's recent creation times
 * (any order); when blocked, the oldest in-window one aging out re-opens it.
 */
export function changeRequestRate(createdAts: readonly Date[], now: Date): ChangeRequestRate {
  const windowStart = now.getTime() - CHANGE_REQUEST_WINDOW_MS;
  const inWindow = createdAts
    .map((d) => d.getTime())
    .filter((t) => t > windowStart)
    .sort((a, b) => a - b);
  if (inWindow.length < CHANGE_REQUEST_DAILY_CAP) return { allowed: true, nextAllowedAt: null };
  return { allowed: false, nextAllowedAt: new Date(inWindow[0]! + CHANGE_REQUEST_WINDOW_MS) };
}
