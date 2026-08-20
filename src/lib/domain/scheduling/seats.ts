/**
 * Seat accounting and scoring shared by the schedule engine and its
 * improvement pass (docs/schedule-generation-plan.md §3).
 *
 * Scoring blends scarcity with the admin-tunable lateness priorities
 * (./params): a targeted cell pulls with its unmet share of target plus its
 * tier's priority/100, so later cells run ahead by about that share instead of
 * absorbing every seat first. Cells without a target only ever rank against
 * each other (they claim no need).
 */
import { AB_WEEKEND_FACTOR } from "../capacity";
import { latenessTier } from "../coverage";
import { demandCellKey } from "../demand";
import { coveredMinutes } from "../intervals";
import type { TimeRange } from "../time";
import { ALL_DAYS, dayTypeOf, type Day, type ShiftBlock } from "../types";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "./params";
import type { Cohort } from "./types";

/** The default day ceiling in engine units (DEFAULT_SCHEDULING_PARAMS.dayCapHours). */
export const DAY_CAP_MINUTES = DEFAULT_SCHEDULING_PARAMS.dayCapHours * 60;

/** Averaged minutes are float-valued (×0.5 weekend factor); compare with tolerance. */
export const EPSILON_MINUTES = 1e-6;

export const DAY_INDEX = new Map(ALL_DAYS.map((d, i) => [d, i]));

export const byEmail = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * FNV-1a 32-bit hash of an email (over its code units). Person-keyed
 * tie-breaks order by this instead of the alphabet: the one-off measured a
 * real alphabetical-rank/hours correlation, and hashing removes that
 * systematic bias. Deterministic and dependency-free on purpose; the need is
 * decorrelation, not cryptography.
 */
export function orderHash(email: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < email.length; i++) {
    hash ^= email.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Orders by hashed email, falling back to byEmail on collision so the order stays total. */
export const byHashedEmail = (a: string, b: string): number =>
  orderHash(a) - orderHash(b) || byEmail(a, b);

/** The tunable lateness pull of a block, as a share of a cell's target (0..1). */
export function tierBonus(block: ShiftBlock, params: SchedulingParams): number {
  const tier = latenessTier(block.end);
  const priority =
    tier === "night" ? params.nightPriority : tier === "evening" ? params.eveningPriority : 0;
  return priority / 100;
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
   * The unmet share of this cell's target (1 = empty, 0 = met), the scarcity
   * half of the scoring blend. Uses the needier rotation week for weekend cells
   * when the student's rotation isn't fixed yet; 0 when the block has no target.
   */
  need(block: ShiftBlock, day: Day, cohort: Cohort | null): number {
    const cap = block.desiredCapacity;
    if (cap == null) return 0;
    const c = this.cell(block.id, day);
    const count =
      block.dayType !== "weekend"
        ? c.a
        : cohort === "a"
          ? c.a
          : cohort === "b"
            ? c.b
            : Math.min(c.a, c.b);
    return (cap - count) / cap;
  }
}
