/**
 * Core domain types, decoupled from the database layer.
 *
 * These describe the scheduling model in PLAN.md §6–§8: positions, shift
 * blocks (per position per day-type), and a student's binary availability
 * selection. All times are minutes since midnight (see ./time).
 */

export type DayType = "weekday" | "weekend";

export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAY_DAYS: readonly Day[] = ["mon", "tue", "wed", "thu", "fri"];
export const WEEKEND_DAYS: readonly Day[] = ["sat", "sun"];
export const ALL_DAYS: readonly Day[] = [...WEEKDAY_DAYS, ...WEEKEND_DAYS];

/** The day-type whose block template applies to a given calendar day. */
export function dayTypeOf(day: Day): DayType {
  return day === "sat" || day === "sun" ? "weekend" : "weekday";
}

/**
 * A named, fixed time range a student can be scheduled into (PLAN.md §6.2).
 * Blocks are defined per position and per day-type and may overlap/stagger.
 * Open/close are derived (see ./blocks), never stored on the block.
 */
export interface ShiftBlock {
  id: string;
  positionId: string;
  dayType: DayType;
  /** minutes since midnight, inclusive start */
  start: number;
  /** minutes since midnight, exclusive end */
  end: number;
  /** admin-marked over-subscribed block; renders a red bar (advisory). */
  highDemand: boolean;
}

/** A selectable availability position (PLAN.md §6.1). */
export interface Position {
  id: string;
  name: string;
  /** weekly hours floor, cycle-averaged (hard min). e.g. 10; Shift Lead 15. */
  minHours: number;
  /** minimum distinct days the selection must span. e.g. 2; Shift Lead 3. */
  minDays: number;
  /** weekday-only position exempt from the weekend rule (Barista). */
  weekendExempt: boolean;
}

/** One cell of the availability grid: this student is willing to work this block on this day. */
export interface SelectedShift {
  blockId: string;
  day: Day;
}
