/**
 * Pure rules for an admin's manual schedule edits on the per-student grid.
 *
 * The grid edits a trial set of cells and saves the whole batch at once, so
 * these rules judge a row SET rather than a single click: the batch's final
 * state is the thing that has to be legal. The only hard rule is that every
 * same-day shift must add unique time: a new block refuses when the student's
 * other shifts already cover its whole span, or when adding it would leave an
 * existing shift covering nothing of its own. Staggered or touching shifts
 * merge into one longer span (domain/intervals.ts) and are fine, which is how
 * a double across a handoff overlap gets scheduled. Assigning a cell the
 * student never selected is allowed; the scheduler owns the schedule and the
 * split grid makes the mismatch visible. Labor rules (scheduling/labor.ts)
 * never block an edit either: `laborWarningsForRows` turns them into warnings
 * the admin sees, and the weekly hour cap (domain/caps.ts) is the same: hard
 * for the generator since 1.15, a warning here, which is what
 * `weekMinutesForRows` is for. `dayConflictMessage` lives here too, so the
 * grid's client-side cue and the server's refusal say the same sentence.
 */
import { redundantRangeIndex } from "../intervals";
import { formatSpan, type TimeRange } from "../time";
import { DAY_LABEL, type Day, type ShiftBlock } from "../types";
import { laborViolations, type LaborLimits } from "./labor";
import { averagedAssignedMinutes } from "./seats";
import type { Cohort } from "./types";

/**
 * The part of an assignment row the coverage rule reads: which cell it is, and
 * the span it covers. The client's trial rows have no cohort to offer, and the
 * rule never asks for one.
 */
export interface RowSpan {
  blockId: string;
  day: Day;
  start: number;
  end: number;
}

/** One of the student's existing current-run rows, with its block's times. */
export interface ExistingAssignment extends RowSpan {
  cohort: Cohort;
}

/**
 * Why a new manual assignment refuses: it adds no time of its own, it would
 * leave an existing shift adding none, or the day's stored shifts already
 * break the rule on their own (possible when block times change under a live
 * run) and need fixing before anything is added.
 */
export type DayConflict =
  | { kind: "candidate-covered" }
  | { kind: "existing-covered"; row: RowSpan }
  | { kind: "day-invalid"; row: RowSpan };

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
  existing: readonly RowSpan[],
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
 * The refusal a conflict reads as, in the admin's words. Shared so the grid's
 * client-side cue on a blocked click and the server's refusal on a saved batch
 * are the same sentence rather than two paraphrases of one rule.
 */
export function dayConflictMessage(block: ShiftBlock, day: Day, conflict: DayConflict): string {
  if (conflict.kind === "candidate-covered") {
    return `Their ${DAY_LABEL[day]} shifts already cover ${formatSpan(block.start, block.end)}.`;
  }
  const span = formatSpan(conflict.row.start, conflict.row.end);
  return conflict.kind === "day-invalid"
    ? `Their ${DAY_LABEL[day]} ${span} shift already covers nothing new. Remove that one first.`
    : `That would leave their ${DAY_LABEL[day]} ${span} shift covering nothing new. Remove that one first.`;
}

/**
 * Labor-rule warnings for a whole set of rows, judged as one standing week
 * (scheduling/labor.ts). The grid saves a batch of edits at once, so what the
 * admin needs told about is the state the batch lands on, not each click on
 * the way there. Warn only, never block; the hard refusals live in
 * findDayConflict and the scheduler owns the schedule. Returns one short
 * sentence per violation, or [] when the week is clean.
 */
export function laborWarningsForRows(
  rows: readonly ExistingAssignment[],
  limits: LaborLimits,
): string[] {
  // labor.ts reads one weekend rotation for the whole map, so a student whose
  // rows mix cohorts (possible through manual edits across runs) is outside
  // its scope; skip the warnings rather than judge half the picture. The
  // read-time validator owns the mixed case.
  const weekendCohorts = new Set<Cohort>();
  for (const row of rows) if (row.cohort !== "weekday") weekendCohorts.add(row.cohort);
  if (weekendCohorts.size > 1) return [];

  const laborCohort = [...weekendCohorts][0] ?? null;
  return laborViolations(rangesForRows(rows), laborCohort, limits).map((v) => `${v.detail}.`);
}

/** The student's standing week these rows come to, day by day. */
function rangesForRows(rows: readonly RowSpan[]): Map<Day, TimeRange[]> {
  const ranges = new Map<Day, TimeRange[]>();
  for (const row of rows) {
    const list = ranges.get(row.day) ?? [];
    list.push({ start: row.start, end: row.end });
    ranges.set(row.day, list);
  }
  return ranges;
}

/**
 * Cycle-averaged weekly minutes a set of rows comes to. Measured with the
 * engine's own `averagedAssignedMinutes` (weekend rows halve under an A/B
 * rotation, count whole under every, weekday rows count whole), so a caller's
 * over-cap warning and the read-time over-max flag can never disagree about
 * the number they are judging.
 */
export function weekMinutesForRows(rows: readonly RowSpan[], everyWeekendOptIn: boolean): number {
  return averagedAssignedMinutes(rangesForRows(rows), everyWeekendOptIn);
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
