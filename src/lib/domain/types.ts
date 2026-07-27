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
/**
 * Sunday first, Saturday last. The scheduling week starts on Sunday (PLAN §7), so
 * the two weekend days sit at opposite ends of one week and never form a contiguous
 * Sat+Sun pair. Grids render columns in this order, so a weekend row reads Sun | Sat.
 */
export const WEEKEND_DAYS: readonly Day[] = ["sun", "sat"];
/** Calendar order for a Sunday-start week: Sun, Mon..Fri, Sat. */
export const ALL_DAYS: readonly Day[] = ["sun", ...WEEKDAY_DAYS, "sat"];

/** Short human label per day ("Mon".."Sun"), shared by grids, exports, and emails. */
export const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

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
  /**
   * Admin-set target staffing per day this block runs (roadmap 5.1). Absent or
   * null = no target. Optional so selection/validation code and fixtures that
   * predate it stay valid; only coverage (and the future generator) read it.
   */
  desiredCapacity?: number | null;
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
