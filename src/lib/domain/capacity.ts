/**
 * Cycle-averaged preference capacity (PLAN.md §7, §8, §10a).
 *
 * "Preference capacity" = the maximum non-overlapping hours that could be
 * scheduled from a student's selection, averaged across the two-week A/B cycle.
 * Weekday blocks happen every week (factor 1). Weekend blocks happen every
 * *other* week under A/B (factor 0.5), or every week with the opt-in (factor 1).
 *
 * Weekend model (decided): BOTH weekend days are summed before applying the
 * factor — a student may be scheduled Saturday and Sunday on their on-weekend.
 */
import { dayTypeOf, type Day, type SelectedShift, type ShiftBlock } from "./types";
import { maxNonOverlappingMinutes } from "./packing";
import type { TimeRange } from "./time";

/** A/B rotation averages a weekend day's hours to half a week. */
export const AB_WEEKEND_FACTOR = 0.5;

export interface CapacityOptions {
  everyWeekendOptIn: boolean;
}

export interface CapacityResult {
  /** sum of best per-day packing over Mon–Fri (minutes). */
  weekdayMinutes: number;
  /** sum of best per-day packing over Sat+Sun, before the cycle factor (minutes). */
  weekendMinutesRaw: number;
  /** weekday + factor*weekend (minutes); the value compared to the hours floor. */
  weeklyAverageMinutes: number;
  /** convenience: weeklyAverageMinutes / 60. */
  weeklyAverageHours: number;
}

export function computeCapacity(
  selection: readonly SelectedShift[],
  blocks: readonly ShiftBlock[],
  options: CapacityOptions,
): CapacityResult {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const rangesByDay = new Map<Day, TimeRange[]>();

  for (const { blockId, day } of selection) {
    const block = byId.get(blockId);
    if (!block) {
      throw new Error(`Selection references unknown block "${blockId}"`);
    }
    const list = rangesByDay.get(day) ?? [];
    list.push({ start: block.start, end: block.end });
    rangesByDay.set(day, list);
  }

  let weekdayMinutes = 0;
  let weekendMinutesRaw = 0;
  for (const [day, ranges] of rangesByDay) {
    const packed = maxNonOverlappingMinutes(ranges);
    if (dayTypeOf(day) === "weekend") {
      weekendMinutesRaw += packed;
    } else {
      weekdayMinutes += packed;
    }
  }

  const factor = options.everyWeekendOptIn ? 1 : AB_WEEKEND_FACTOR;
  const weeklyAverageMinutes = weekdayMinutes + factor * weekendMinutesRaw;

  return {
    weekdayMinutes,
    weekendMinutesRaw,
    weeklyAverageMinutes,
    weeklyAverageHours: weeklyAverageMinutes / 60,
  };
}

/** Distinct calendar days the selection touches (for the min-days rule). */
export function distinctSelectedDays(selection: readonly SelectedShift[]): Set<Day> {
  return new Set(selection.map((s) => s.day));
}
