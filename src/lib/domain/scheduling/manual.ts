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
 * `planScheduleEdits` is the whole batch decision in one pure pass, so the
 * sequence a save applies can be tested without a database behind it.
 */
import { redundantRangeIndex } from "../intervals";
import { formatSpan, type TimeRange } from "../time";
import { ALL_DAYS, DAY_LABEL, dayTypeOf, type Day, type ShiftBlock } from "../types";
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

/** One (block, day) cell of an edit batch: what the grid's Save sends. */
export interface EditCell {
  blockId: string;
  day: Day;
}

/** One row the batch will write, with the rotation it lands in. */
export interface PlannedInsert extends EditCell {
  cohort: Cohort;
}

/**
 * What a batch comes to: the deletes, then the inserts in the order they were
 * judged, and the row set the whole thing lands on (what the warnings are
 * judged against). A refusal carries no operations at all, since the batch is
 * all-or-nothing.
 */
export type ScheduleEditPlan =
  | {
      ok: true;
      removes: readonly EditCell[];
      inserts: readonly PlannedInsert[];
      rows: ExistingAssignment[];
    }
  | { ok: false; error: string };

/** Context a batch is judged in: the live blocks it may use, and the rotation. */
export interface EditPlanContext {
  /** Live (non-retired) blocks by id; a missing id reads as "shift is gone". */
  blocks: ReadonlyMap<string, ShiftBlock>;
  everyWeekendOptIn: boolean;
}

/**
 * Names the cell a refusal is about ("Sat 8a to 12p"), since a batch save can
 * fail on any one of several cells and the admin has to know which to fix.
 * Falls back to the day alone when the block itself is gone.
 */
function cellName(day: Day, block: ShiftBlock | null): string {
  return block ? `${DAY_LABEL[day]} ${formatSpan(block.start, block.end)}` : DAY_LABEL[day];
}

/**
 * The whole batch decision, with no database in it: removals first, then the
 * additions in calendar order, each judged against the rows as the batch has
 * left them rather than against the state it started in. So a removal can free
 * the day for a later add, an add can be refused for clashing with nothing but
 * an earlier add of the same batch, and the first weekend add fixes the
 * rotation the rest follow.
 *
 * Order is fixed here (day, then earliest block, then id) precisely because it
 * decides blame: of two adds that cannot both stand, the calendar-earlier one
 * is applied and the later one is the cell the refusal names, whatever order
 * the grid happened to send them in. One bad cell refuses the batch: the caller
 * gets the sentence and nothing to apply, never a partial list.
 */
export function planScheduleEdits(
  current: readonly ExistingAssignment[],
  removes: readonly EditCell[],
  adds: readonly EditCell[],
  ctx: EditPlanContext,
): ScheduleEditPlan {
  // A removal with no row is a no-op here; the caller still issues its delete,
  // so a cell the admin let go of is gone whatever the read found.
  const rows: ExistingAssignment[] = [...current];
  for (const cell of removes) {
    const at = rows.findIndex((r) => r.blockId === cell.blockId && r.day === cell.day);
    if (at >= 0) rows.splice(at, 1);
  }

  const ordered = [...adds].sort(
    (a, b) =>
      ALL_DAYS.indexOf(a.day) - ALL_DAYS.indexOf(b.day) ||
      (ctx.blocks.get(a.blockId)?.start ?? 0) - (ctx.blocks.get(b.blockId)?.start ?? 0) ||
      a.blockId.localeCompare(b.blockId),
  );

  const inserts: PlannedInsert[] = [];
  for (const cell of ordered) {
    // Adding a cell they already hold is a no-op, not a conflict with itself.
    if (rows.some((r) => r.blockId === cell.blockId && r.day === cell.day)) continue;
    const block = ctx.blocks.get(cell.blockId) ?? null;
    if (!block) {
      return { ok: false, error: `${cellName(cell.day, null)}: That shift no longer exists.` };
    }
    if (dayTypeOf(cell.day) !== block.dayType) {
      return {
        ok: false,
        error: `${cellName(cell.day, block)}: That shift does not run on ${DAY_LABEL[cell.day]}.`,
      };
    }
    const clash = findDayConflict(block, cell.day, rows);
    if (clash) {
      return {
        ok: false,
        error: `${cellName(cell.day, block)}: ${dayConflictMessage(block, cell.day, clash)}`,
      };
    }

    const cohort: Cohort =
      block.dayType === "weekend" ? manualWeekendCohort(rows, ctx.everyWeekendOptIn) : "weekday";
    inserts.push({ blockId: cell.blockId, day: cell.day, cohort });
    rows.push({ blockId: cell.blockId, day: cell.day, cohort, start: block.start, end: block.end });
  }

  return { ok: true, removes, inserts, rows };
}
