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

// Capacity is float-valued (x0.5 weekend factor); compare with a small tolerance.
const EPSILON_MINUTES = 1e-6;

const hoursLabel = (minutes: number) => (minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1);

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

export type BlockSetWarningKind = "no_weekend_blocks" | "min_hours_unreachable";

export interface BlockSetWarning {
  kind: BlockSetWarningKind;
  message: string;
}

/**
 * Advisory warnings over a position's full block set (callers pass a list
 * already filtered to the position). Flags a missing weekend layout for a
 * position that must work weekends (PLAN §5 #5), and a min-hours floor no
 * selection can reach: even with every block selected on every applicable
 * day (per-day covered union, weekdays x5, both weekend days summed then
 * x0.5 under A/B) the cycle average stays below position.minHours (§5 #2).
 */
export function blockSetWarnings(
  position: Position,
  blocks: readonly ShiftBlock[],
): BlockSetWarning[] {
  const warnings: BlockSetWarning[] = [];

  if (!position.weekendExempt && !blocks.some((b) => b.dayType === "weekend")) {
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
  if (capacity.weeklyAverageMinutes + EPSILON_MINUTES < position.minHours * 60) {
    warnings.push({
      kind: "min_hours_unreachable",
      message: `These blocks cover at most ${hoursLabel(capacity.weeklyAverageMinutes)}h a week, under the ${position.minHours}h minimum.`,
    });
  }

  return warnings;
}
