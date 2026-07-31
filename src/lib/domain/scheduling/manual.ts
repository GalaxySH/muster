/**
 * Pure rules for an admin's manual schedule edits on the per-student grid.
 *
 * Manual edits mutate the current run's rows directly (no new run per edit).
 * The only hard rule is no same-day containment against the student's other
 * assigned blocks: a shift whose times sit inside an existing one (or swallow
 * one) adds no working time, while staggered or touching shifts merge into one
 * longer span (domain/intervals.ts) and are fine, which is how a double across
 * a handoff overlap gets scheduled. Assigning a cell the student never
 * selected is allowed; the scheduler owns the schedule and the split grid
 * makes the mismatch visible.
 */
import { eitherContains, type TimeRange } from "../time";
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
 * The existing same-day assignment that contains the new block's times or is
 * contained by them (identical times included), or null. Staggered overlaps
 * and touching endpoints are not conflicts.
 */
export function findDayConflict(
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
        eitherContains({ start: row.start, end: row.end }, range),
    ) ?? null
  );
}

/**
 * True when the conflicting assignment's times cover the whole new block
 * (identical times included); false when the new block swallows it instead.
 * Only meaningful for a pair findDayConflict reported, which guarantees the
 * containment runs one way or the other.
 */
export function conflictCovers(row: ExistingAssignment, block: ShiftBlock): boolean {
  return row.start <= block.start && block.end <= row.end;
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
