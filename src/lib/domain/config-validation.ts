/**
 * Admin block-set validation for the positions config surface (roadmap 3.3;
 * PLAN.md §6).
 *
 * validateBlockTimes gates a single block's times at entry. blockSetWarnings
 * produces advisory warnings about a position's whole block set; nothing here
 * blocks saving. Pure so the admin UI and the server actions run the same
 * checks.
 */
import { computeCapacity } from "./capacity";
import {
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  type Position,
  type SelectedShift,
  type ShiftBlock,
} from "./types";

/** Blocks may end exactly at midnight (24:00). */
const MINUTES_PER_DAY = 1440;

// Coverage and seat-hour sums are float-valued (x0.5 weekend factor, minute to
// hour division); compare with a small tolerance.
const EPSILON = 1e-6;

/** Whole hours plain, fractions with one decimal (10, 12.5). */
export const hoursLabel = (minutes: number) =>
  (minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1);

/** Upper bound on a block's target staffing; keeps typos out of coverage math. */
export const DESIRED_CAPACITY_MAX = 99;

/**
 * Check a block's target staffing (roadmap 5.1). Null means no target and is
 * always valid. Returns an error message, or null when valid.
 */
export function validateDesiredCapacity(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > DESIRED_CAPACITY_MAX) {
    return `Target staffing must be a whole number from 1 to ${DESIRED_CAPACITY_MAX}, or blank for no target.`;
  }
  return null;
}

/** Check one block's start/end minutes. Returns an error message, or null when valid. */
export function validateBlockTimes(start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return "Times must be whole minutes.";
  }
  if (start < 0 || end > MINUTES_PER_DAY) {
    return "Times must be within a single day.";
  }
  if (start >= end) {
    return "The start time must be before the end time.";
  }
  return null;
}

export type BlockSetWarningKind =
  | "no_weekday_blocks"
  | "no_weekend_blocks"
  | "min_hours_unreachable"
  | "min_days_unreachable";

export interface BlockSetWarning {
  kind: BlockSetWarningKind;
  message: string;
}

/**
 * Advisory warnings over a position's full block set (callers pass a list
 * already filtered to the position). Flags a missing weekday or weekend layout
 * for a position that needs one (every position works weekdays; non-exempt
 * positions also work weekends, PLAN §5 #5), a min-hours floor no selection can
 * reach (even with every block selected on every applicable day the cycle
 * average stays below position.minHours, §5 #2), and a min-days floor no
 * selection can span (the block set touches fewer distinct days than
 * position.minDays, §7).
 */
export function blockSetWarnings(
  position: Position,
  blocks: readonly ShiftBlock[],
): BlockSetWarning[] {
  const warnings: BlockSetWarning[] = [];

  const hasWeekday = blocks.some((b) => b.dayType === "weekday");
  const hasWeekend = blocks.some((b) => b.dayType === "weekend");

  if (!hasWeekday) {
    warnings.push({
      kind: "no_weekday_blocks",
      message: "This position has no weekday blocks.",
    });
  }

  if (!position.weekendExempt && !hasWeekend) {
    warnings.push({
      kind: "no_weekend_blocks",
      message: "This position requires weekend work but has no weekend blocks.",
    });
  }

  // The most any student can cover: every block selected on every day it applies to.
  const fullSelection: SelectedShift[] = blocks.flatMap((b) =>
    (b.dayType === "weekend" ? WEEKEND_DAYS : WEEKDAY_DAYS).map((day) => ({
      blockId: b.id,
      day,
    })),
  );
  const capacity = computeCapacity(fullSelection, blocks, { everyWeekendOptIn: false });
  if (capacity.weeklyAverageMinutes + EPSILON < position.minHours * 60) {
    warnings.push({
      kind: "min_hours_unreachable",
      message: `These blocks cover at most ${hoursLabel(capacity.weeklyAverageMinutes)}h a week, under the ${position.minHours}h minimum.`,
    });
  }

  // The most distinct days a selection can span: a weekday layout opens all five
  // weekdays, a weekend layout both weekend days. Fewer than the floor means
  // min_days can never pass no matter what the student picks (e.g. a Shift Lead
  // whose config has only weekend blocks maxes out at 2 days, under its 3).
  const maxDays = (hasWeekday ? WEEKDAY_DAYS.length : 0) + (hasWeekend ? WEEKEND_DAYS.length : 0);
  if (maxDays < position.minDays) {
    warnings.push({
      kind: "min_days_unreachable",
      message: `These blocks span at most ${maxDays} ${maxDays === 1 ? "day" : "days"}, under the ${position.minDays}-day minimum.`,
    });
  }

  return warnings;
}

/**
 * The weekly seat hours a position's blocks provide: for each block, its target
 * staffing times its length times the days it runs (weekday layouts run five
 * days, weekend layouts both weekend days at full weight, since a weekend seat is
 * staffed every week as students rotate onto it). A block with no target
 * contributes nothing. This is the supply side of positionCapacityCheck.
 */
export function seatHoursPerWeek(blocks: readonly ShiftBlock[]): number {
  return blocks.reduce((sum, b) => {
    const days = b.dayType === "weekend" ? WEEKEND_DAYS.length : WEEKDAY_DAYS.length;
    return sum + (b.desiredCapacity ?? 0) * ((b.end - b.start) / 60) * days;
  }, 0);
}

export type PositionCapacityCheck =
  | { kind: "ok"; supplyHours: number; demandHours: number }
  | { kind: "short"; supplyHours: number; demandHours: number; message: string }
  | { kind: "no_targets" };

/**
 * Weekly seat-hours check for a position (roadmap 5.1): can the admin-set
 * staffing targets give every rostered student in the position their minimum
 * weekly hours? A block without a target supplies zero seats; when no block
 * has a target at all there is nothing to check and the result says so.
 *
 * Weekend seats count on both weekend days at full weight, unlike a student's
 * cycle-averaged selection: a weekend seat is staffed every week (students
 * rotate onto it), and the demand side uses the weekly minimum, so both sides
 * of the comparison are weekly averages.
 */
export function positionCapacityCheck(
  blocks: readonly ShiftBlock[],
  onRosterCount: number,
  minHours: number,
): PositionCapacityCheck {
  if (blocks.every((b) => b.desiredCapacity == null)) return { kind: "no_targets" };

  const supplyHours = seatHoursPerWeek(blocks);
  const demandHours = onRosterCount * minHours;
  if (supplyHours + EPSILON < demandHours) {
    return {
      kind: "short",
      supplyHours,
      demandHours,
      message: `Shift targets add up to about ${Math.round(supplyHours)} seat hours a week, but ${onRosterCount} rostered ${onRosterCount === 1 ? "student needs" : "students need"} at least ${demandHours}.`,
    };
  }
  return { kind: "ok", supplyHours, demandHours };
}
