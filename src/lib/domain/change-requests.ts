/**
 * Pure rules for student schedule change requests (roadmap 3.1).
 *
 * A change request refers to the student's actual W2W schedule, which Muster
 * doesn't model, so the day is the only structured field; the shift time(s)
 * and the ask are the student's own words. The rate cap is a modest rolling
 * 24-hour limit on created requests (withdrawing doesn't refund it).
 */
import { ALL_DAYS, type Day } from "./types";

export const CHANGE_REQUEST_DAILY_CAP = 3;
export const CHANGE_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_SHIFT_TEXT_LENGTH = 200;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_CHANGE_REQUEST_FILES = 3;

export interface ChangeRequestValue {
  day: Day;
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
  if (!(ALL_DAYS as readonly string[]).includes(input.day)) {
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
  return { ok: true, value: { day: input.day as Day, shiftText, comment, permanent: input.permanent } };
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
