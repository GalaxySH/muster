/**
 * Seat accounting and scoring shared by the schedule engine and its
 * improvement pass (docs/schedule-generation-plan.md §3).
 */
import { AB_WEEKEND_FACTOR } from "../capacity";
import { latenessTier, type LatenessTier } from "../coverage";
import { demandCellKey } from "../demand";
import { coveredMinutes } from "../intervals";
import type { TimeRange } from "../time";
import { ALL_DAYS, dayTypeOf, type Day, type ShiftBlock } from "../types";
import type { Cohort } from "./types";

/** Hard ceiling on one day's merged assigned span (the min-days rule's guard). */
export const DAY_CAP_MINUTES = 8 * 60;

/** Later-ending cells staff up first; tied tiers fall through to scarcity. */
export const LATENESS_SCORE: Record<LatenessTier, number> = { night: 3, evening: 2, day: 1 };

/** Averaged minutes are float-valued (×0.5 weekend factor); compare with tolerance. */
export const EPSILON_MINUTES = 1e-6;

export const DAY_INDEX = new Map(ALL_DAYS.map((d, i) => [d, i]));

export const byEmail = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What filling one seat in this cell is worth to the improvement objective:
 * cells with a staffing target score their lateness tier, untargeted cells
 * score nothing (they are real work, but nothing measures their shortfall).
 */
export function seatScore(block: ShiftBlock): number {
  return block.desiredCapacity == null ? 0 : LATENESS_SCORE[latenessTier(block.end)];
}

/** Weekday covered minutes plus cycle-factored weekend covered minutes. */
export function averagedAssignedMinutes(
  ranges: ReadonlyMap<Day, readonly TimeRange[]>,
  everyWeekendOptIn: boolean,
): number {
  let weekday = 0;
  let weekend = 0;
  for (const [day, list] of ranges) {
    const covered = coveredMinutes(list);
    if (dayTypeOf(day) === "weekend") weekend += covered;
    else weekday += covered;
  }
  return weekday + (everyWeekendOptIn ? 1 : AB_WEEKEND_FACTOR) * weekend;
}

/**
 * Seats taken per (block × day) cell. Weekend cells track the two rotation
 * weeks separately: an actual Saturday is staffed by cohort A plus every-weekend
 * students one week and cohort B plus every-weekend the next, so the capacity
 * target binds per week, not per row count.
 */
export class SeatLedger {
  private counts = new Map<string, { a: number; b: number }>();

  private cell(blockId: string, day: Day) {
    const key = demandCellKey(blockId, day);
    let c = this.counts.get(key);
    if (!c) {
      c = { a: 0, b: 0 };
      this.counts.set(key, c);
    }
    return c;
  }

  add(blockId: string, day: Day, cohort: Cohort): void {
    const c = this.cell(blockId, day);
    if (cohort === "b") c.b += 1;
    else if (cohort === "every") {
      c.a += 1;
      c.b += 1;
    } else c.a += 1;
  }

  remove(blockId: string, day: Day, cohort: Cohort): void {
    const c = this.cell(blockId, day);
    if (cohort === "b") c.b -= 1;
    else if (cohort === "every") {
      c.a -= 1;
      c.b -= 1;
    } else c.a -= 1;
  }

  /** Can this student take a seat here? cohort null = rotation not chosen yet. */
  fits(block: ShiftBlock, day: Day, cohort: Cohort | null): boolean {
    const cap = block.desiredCapacity ?? Infinity;
    const c = this.cell(block.id, day);
    if (block.dayType !== "weekend") return c.a < cap;
    if (cohort === "a") return c.a < cap;
    if (cohort === "b") return c.b < cap;
    if (cohort === "every") return c.a < cap && c.b < cap;
    return c.a < cap || c.b < cap;
  }

  /** Which rotation weeks still have room in this cell. */
  openCohorts(block: ShiftBlock, day: Day): { a: boolean; b: boolean } {
    const cap = block.desiredCapacity ?? Infinity;
    const c = this.cell(block.id, day);
    return { a: c.a < cap, b: c.b < cap };
  }

  /**
   * People still missing against the target, for scarcity ranking. Uses the
   * needier rotation week for weekend cells; 0 when the block has no target.
   */
  shortfall(block: ShiftBlock, day: Day, cohort: Cohort | null): number {
    const cap = block.desiredCapacity;
    if (cap == null) return 0;
    const c = this.cell(block.id, day);
    if (block.dayType !== "weekend") return cap - c.a;
    if (cohort === "a") return cap - c.a;
    if (cohort === "b") return cap - c.b;
    return cap - Math.min(c.a, c.b);
  }
}
