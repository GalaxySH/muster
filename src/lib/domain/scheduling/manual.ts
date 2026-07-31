/**
 * Pure rules for an admin's manual schedule edits on the per-student grid.
 *
 * Manual edits mutate the current run's rows directly (no new run per edit).
 * The only hard rule is that every same-day shift must add unique time: a new
 * block refuses when the student's other shifts already cover its whole span,
 * or when adding it would leave an existing shift covering nothing of its own.
 * Staggered or touching shifts merge into one longer span
 * (domain/intervals.ts) and are fine, which is how a double across a handoff
 * overlap gets scheduled. Assigning a cell the student never selected is
 * allowed; the scheduler owns the schedule and the split grid makes the
 * mismatch visible.
 */
import { redundantRangeIndex } from "../intervals";
import type { TimeRange } from "../time";
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
 * Why a new manual assignment refuses: it adds no time of its own, or it
 * would leave an existing shift adding none.
 */
export type DayConflict =
  | { kind: "candidate-covered" }
  | { kind: "existing-covered"; row: ExistingAssignment };

/**
 * The conflict a new same-day assignment would create, or null. Every shift
 * on a day must cover at least one minute no other shift covers; the union is
 * a set of minutes, not a hull, so a shift between two disjoint ones is fine,
 * as are staggered overlaps and touching endpoints. The candidate goes first
 * in the checked set, so identical times report candidate-covered.
 */
export function findDayConflict(
  block: ShiftBlock,
  day: Day,
  existing: readonly ExistingAssignment[],
): DayConflict | null {
  const rows = existing.filter((r) => r.day === day && r.blockId !== block.id);
  const set: TimeRange[] = [
    { start: block.start, end: block.end },
    ...rows.map((r) => ({ start: r.start, end: r.end })),
  ];
  const redundant = redundantRangeIndex(set);
  if (redundant < 0) return null;
  return redundant === 0
    ? { kind: "candidate-covered" }
    : { kind: "existing-covered", row: rows[redundant - 1]! };
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
