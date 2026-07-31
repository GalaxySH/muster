/**
 * Pure rules for an admin's manual schedule edits on the per-student grid.
 *
 * Manual edits mutate the current run's rows directly (no new run per edit).
 * The only hard rule is no same-day time overlap with the student's other
 * assigned blocks: overlapping shifts would double-book them, while touching
 * shifts merge into one span (domain/intervals.ts) and are fine. Assigning a
 * cell the student never selected is allowed; the scheduler owns the schedule
 * and the split grid makes the mismatch visible.
 */
import { overlaps, type TimeRange } from "../time";
import type { Day, ShiftBlock } from "../types";
import type { Cohort } from "./types";

/** One of the student's existing current-run rows, with its block's times. */
export interface ExistingAssignment {
  blockId: string;
  day: Day;
  cohort: Cohort;
  start: number;
  end: number;
}

/**
 * The existing same-day assignment the new block truly overlaps, or null.
 * Touching endpoints (5p end against 5p start) are not an overlap.
 */
export function findDayOverlap(
  block: ShiftBlock,
  day: Day,
  existing: readonly ExistingAssignment[],
): ExistingAssignment | null {
  const range: TimeRange = { start: block.start, end: block.end };
  return (
    existing.find(
      (row) =>
        row.day === day &&
        row.blockId !== block.id &&
        overlaps({ start: row.start, end: row.end }, range),
    ) ?? null
  );
}

/**
 * Weekend cohort for a new manual weekend assignment: the student's existing
 * current-run weekend rows already fix their rotation, so reuse it; otherwise
 * "every" for every-weekend opt-ins; otherwise default to "a".
 */
export function manualWeekendCohort(
  existing: readonly ExistingAssignment[],
  everyWeekendOptIn: boolean,
): Exclude<Cohort, "weekday"> {
  const weekend = existing.find((row) => row.cohort !== "weekday");
  if (weekend) return weekend.cohort as Exclude<Cohort, "weekday">;
  return everyWeekendOptIn ? "every" : "a";
}
