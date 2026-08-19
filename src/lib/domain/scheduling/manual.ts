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
 * mismatch visible. Labor rules (scheduling/labor.ts) never block an edit
 * either: laborWarningsForEdit turns them into warnings the admin sees.
 */
import { redundantRangeIndex } from "../intervals";
import type { TimeRange } from "../time";
import type { Day, ShiftBlock } from "../types";
import { laborViolations, type LaborLimits } from "./labor";
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
 * Why a new manual assignment refuses: it adds no time of its own, it would
 * leave an existing shift adding none, or the day's stored shifts already
 * break the rule on their own (possible when block times change under a live
 * run) and need fixing before anything is added.
 */
export type DayConflict =
  | { kind: "candidate-covered" }
  | { kind: "existing-covered"; row: ExistingAssignment }
  | { kind: "day-invalid"; row: ExistingAssignment };

/**
 * The conflict a new same-day assignment would create, or null. Every shift
 * on a day must cover at least one minute no other shift covers; the union is
 * a set of minutes, not a hull, so a shift between two disjoint ones is fine,
 * as are staggered overlaps and touching endpoints. The candidate goes first
 * in the checked set, so identical times report candidate-covered. Rows are
 * sorted here so the reported shift never depends on caller ordering.
 */
export function findDayConflict(
  block: ShiftBlock,
  day: Day,
  existing: readonly ExistingAssignment[],
): DayConflict | null {
  const rows = existing
    .filter((r) => r.day === day && r.blockId !== block.id)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.blockId.localeCompare(b.blockId));
  const rowRanges: TimeRange[] = rows.map((r) => ({ start: r.start, end: r.end }));
  // A day whose stored rows are already redundant among themselves is not the
  // new shift's fault; report it as its own case so the copy stays honest.
  const already = redundantRangeIndex(rowRanges);
  if (already >= 0) return { kind: "day-invalid", row: rows[already]! };
  const redundant = redundantRangeIndex([{ start: block.start, end: block.end }, ...rowRanges]);
  if (redundant < 0) return null;
  return redundant === 0
    ? { kind: "candidate-covered" }
    : { kind: "existing-covered", row: rows[redundant - 1]! };
}

/**
 * Labor-rule warnings for a new manual assignment: the student's existing
 * current-run rows plus the candidate, judged as one standing week
 * (scheduling/labor.ts). Warn only, never block; the hard refusals live in
 * findDayConflict and the scheduler owns the schedule. Returns one short
 * sentence per violation, or [] when the week is clean.
 */
export function laborWarningsForEdit(
  candidate: { block: ShiftBlock; day: Day },
  cohort: Cohort,
  existing: readonly ExistingAssignment[],
  limits: LaborLimits,
): string[] {
  // labor.ts reads one weekend rotation for the whole map, so a student whose
  // rows mix cohorts (possible through manual edits across runs) is outside
  // its scope; skip the warnings rather than judge half the picture. The
  // read-time validator owns the mixed case.
  const weekendCohorts = new Set<Cohort>();
  for (const row of existing) if (row.cohort !== "weekday") weekendCohorts.add(row.cohort);
  if (cohort !== "weekday") weekendCohorts.add(cohort);
  if (weekendCohorts.size > 1) return [];

  const ranges = new Map<Day, TimeRange[]>();
  const add = (day: Day, range: TimeRange) => {
    const list = ranges.get(day) ?? [];
    list.push(range);
    ranges.set(day, list);
  };
  for (const row of existing) add(row.day, { start: row.start, end: row.end });
  add(candidate.day, { start: candidate.block.start, end: candidate.block.end });

  const laborCohort = [...weekendCohorts][0] ?? null;
  return laborViolations(ranges, laborCohort, limits).map((v) => `${v.detail}.`);
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
