/**
 * Labor rules on the canonical fortnight calendar
 * (docs/generator-constraints-fairness-plan.md §1 and §2).
 *
 * The fortnight: indices 0..13 = [Sun1, Mon1..Fri1, Sat1, Sun2, Mon2..Fri2,
 * Sat2]. W2W week 1 is slots 0..6 and week 2 is slots 7..13. The pattern
 * repeats, so slot 13 is cyclically adjacent to slot 0: Sat2's close meets
 * Sun1's open.
 *
 * Rotation "a" works the contiguous on-weekend (Sat1 = 6, Sun2 = 7); rotation
 * "b" works (Sat2 = 13, Sun1 = 0); "every" occupies all four weekend slots. A
 * weekday day occupies both halves (slot d and slot d + 7, with Sun = 0 ..
 * Sat = 6 inside week 1), so a weekday-only pattern degenerates to a
 * 7-day-periodic cycle.
 *
 * Symmetry lemma: the "b" slot table is the "a" table rotated by +7 mod 14
 * (weekday slots {d, d + 7} are rotation-invariant as a set; Sat 6 -> 13 and
 * Sun 7 -> 0 are that same shift), and every rule here is invariant under the
 * rotation: cyclic runs and cyclically adjacent rest pairs rotate whole, and
 * per-half totals just swap between two halves checked against identical
 * limits. So "a" and "b" verdicts agree for EVERY ranges map, not only
 * weekday-only ones. A cohort of null is therefore evaluated canonically as
 * "a", and nothing here depends on the ledger's later cohort-balance choice.
 *
 * Input contract: ranges hold within-day minutes (0 <= start < end <= 1440,
 * the stored-block invariant in domain/config-validation.ts); a corrupt range
 * past midnight throws in the detail formatter rather than misjudging
 * quietly. The single cohort argument cannot express a mixed-cohort student
 * (a Sat row in "a" and a Sun row in "b", possible through manual edits);
 * that case belongs to the independent validator (validate.ts), which maps
 * each row by its own cohort.
 */
import { mergeRanges } from "../intervals";
import { formatSpan, formatTime, type TimeRange } from "../time";
import { ALL_DAYS, DAY_LABEL, dayTypeOf, type Day } from "../types";
import type { SchedulingParams } from "./params";
import type { Cohort } from "./types";

/** The W2W weekly hour ceiling. Payroll law, deliberately not a param. */
export const WEEK_CAP_MINUTES = 40 * 60;

const MINUTES_PER_DAY = 24 * 60;

/** Each day's slot inside week 1 (Sunday-start, PLAN §7); ALL_DAYS shares the order. */
const WEEK1_SLOT: Record<Day, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * The fortnight slots a day's assignments occupy. Weekday days sit in both
 * halves whatever the cohort; a weekend day sits in its rotation's half, or in
 * both under "every". Null (rotation not chosen yet) and "weekday" (the
 * assignment-row value) evaluate as "a" per the symmetry lemma above.
 */
export function slotIndices(day: Day, cohort: Cohort | null): number[] {
  const d = WEEK1_SLOT[day];
  if (dayTypeOf(day) === "weekday") return [d, d + 7];
  if (cohort === "every") return day === "sun" ? [0, 7] : [6, 13];
  if (cohort === "b") return day === "sun" ? [0] : [13];
  return day === "sun" ? [7] : [6];
}

/** The labor rules' numeric bounds, in minutes and days. */
export interface LaborLimits {
  dayCapMinutes: number;
  weekCapMinutes: number;
  maxConsecutiveDays: number;
  maxDaysPerWeek: number;
  preferredDaysPerWeek: number;
  minRestMinutes: number;
  preferredRestMinutes: number;
}

export function laborLimits(params: SchedulingParams): LaborLimits {
  return {
    dayCapMinutes: params.dayCapHours * 60,
    weekCapMinutes: WEEK_CAP_MINUTES,
    maxConsecutiveDays: params.maxConsecutiveDays,
    maxDaysPerWeek: params.maxDaysPerWeek,
    preferredDaysPerWeek: params.preferredDaysPerWeek,
    minRestMinutes: params.minRestHours * 60,
    preferredRestMinutes: params.preferredRestHours * 60,
  };
}

export type LaborRule =
  | "day-hours"
  | "week-hours"
  | "consecutive-days"
  | "days-per-week"
  | "clopen"
  | "short-rest"
  | "split-shift";

export interface LaborViolation {
  rule: LaborRule;
  severity: "hard" | "soft";
  detail: string;
}

/**
 * How far the relax ladder has opened: "strict" also rejects every soft
 * violation, "relax-rest" tolerates short rest, "relax-days" tolerates short
 * rest and a day count over the preferred. Hard rules reject in every mode.
 */
export type LaborMode = "strict" | "relax-rest" | "relax-days";

/** One day's merged coverage: everything the rules read about a single day. */
interface DayStats {
  day: Day;
  /** Sorted maximal spans; more than one means the day is split. */
  merged: TimeRange[];
  /** Covered minutes (the merged spans summed). */
  minutes: number;
}

function statsFor(day: Day, list: readonly TimeRange[]): DayStats {
  const merged = mergeRanges(list);
  let minutes = 0;
  for (const r of merged) minutes += r.end - r.start;
  return { day, merged, minutes };
}

/** The occupied day behind each fortnight slot; null where the slot is off. */
function slotTable(days: readonly DayStats[], cohort: Cohort | null): (DayStats | null)[] {
  const slots: (DayStats | null)[] = new Array<DayStats | null>(14).fill(null);
  for (const d of days) {
    for (const i of slotIndices(d.day, cohort)) slots[i] = d;
  }
  return slots;
}

/** Occupied-slot count and merged minutes of one fortnight half (0 = week 1). */
function halfTotals(slots: readonly (DayStats | null)[], half: 0 | 1) {
  let count = 0;
  let minutes = 0;
  for (let i = half * 7; i < half * 7 + 7; i++) {
    const s = slots[i];
    if (s) {
      count += 1;
      minutes += s.minutes;
    }
  }
  return { count, minutes };
}

/** Longest cyclic run of occupied slots and where it starts; 14 when every slot is on. */
function longestCyclicRun(slots: readonly (DayStats | null)[]): { length: number; start: number } {
  let best = 0;
  let bestStart = 0;
  let current = 0;
  // Scanning the doubled sequence catches runs that wrap the 13 to 0 seam.
  for (let i = 0; i < 28 && best < 14; i++) {
    if (slots[i % 14]) {
      current += 1;
      if (current > best) {
        best = current;
        bestStart = i - current + 1;
      }
    } else {
      current = 0;
    }
  }
  return { length: best, start: bestStart % 14 };
}

/** Overnight rest in minutes from prev's last clock-out to next's first clock-in. */
function restBetween(prev: DayStats, next: DayStats): number {
  return next.merged[0]!.start + MINUTES_PER_DAY - prev.merged[prev.merged.length - 1]!.end;
}

const hoursText = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/** A clock time; a span may end exactly at midnight, which reads as 12a. */
const timeText = (minutes: number): string => formatTime(minutes === MINUTES_PER_DAY ? 0 : minutes);

const slotText = (slot: number): string =>
  `${DAY_LABEL[ALL_DAYS[slot % 7]!]} of week ${slot < 7 ? 1 : 2}`;

const restText = (prev: DayStats, next: DayStats): string =>
  `between ${DAY_LABEL[prev.day]} ending ${timeText(prev.merged[prev.merged.length - 1]!.end)}` +
  ` and ${DAY_LABEL[next.day]} starting ${timeText(next.merged[0]!.start)}`;

/**
 * Every labor violation in a standing weekly pattern. Each day's ranges are
 * merged first, so touching or staggered same-day shifts count as one span;
 * any remaining gap, however small, is a split shift.
 */
export function laborViolations(
  ranges: ReadonlyMap<Day, readonly TimeRange[]>,
  cohort: Cohort | null,
  limits: LaborLimits,
): LaborViolation[] {
  const days: DayStats[] = [];
  for (const day of ALL_DAYS) {
    const list = ranges.get(day);
    if (list && list.length > 0) days.push(statsFor(day, list));
  }
  const slots = slotTable(days, cohort);
  const violations: LaborViolation[] = [];

  for (const d of days) {
    if (d.merged.length > 1) {
      violations.push({
        rule: "split-shift",
        severity: "hard",
        detail: `${DAY_LABEL[d.day]} splits into ${d.merged.length} separate shifts (${d.merged
          .map((r) => formatSpan(r.start, r.end))
          .join(", ")})`,
      });
    }
    if (d.minutes > limits.dayCapMinutes) {
      violations.push({
        rule: "day-hours",
        severity: "hard",
        detail: `${DAY_LABEL[d.day]} covers ${hoursText(d.minutes)}, over the ${hoursText(limits.dayCapMinutes)} day limit`,
      });
    }
  }

  for (const half of [0, 1] as const) {
    const { count, minutes } = halfTotals(slots, half);
    const week = `Week ${half + 1}`;
    if (minutes > limits.weekCapMinutes) {
      violations.push({
        rule: "week-hours",
        severity: "hard",
        detail: `${week} totals ${hoursText(minutes)}, over the ${hoursText(limits.weekCapMinutes)} weekly limit`,
      });
    }
    if (count > limits.maxDaysPerWeek) {
      violations.push({
        rule: "days-per-week",
        severity: "hard",
        detail: `${week} has ${count} working days, over the limit of ${limits.maxDaysPerWeek}`,
      });
    } else if (count > limits.preferredDaysPerWeek) {
      violations.push({
        rule: "days-per-week",
        severity: "soft",
        detail: `${week} has ${count} working days, more than the preferred ${limits.preferredDaysPerWeek}`,
      });
    }
  }

  const run = longestCyclicRun(slots);
  if (run.length > limits.maxConsecutiveDays) {
    violations.push({
      rule: "consecutive-days",
      severity: "hard",
      detail:
        run.length === 14
          ? "Works every day of the two week cycle"
          : `${run.length} days in a row, ${slotText(run.start)} through ${slotText(
              (run.start + run.length - 1) % 14,
            )}`,
    });
  }

  // A weekday pair repeats identically in both halves (there is only one set
  // of ranges per day), so each day pair is reported once.
  const reported = new Set<string>();
  for (let i = 0; i < 14; i++) {
    const prev = slots[i];
    const next = slots[(i + 1) % 14];
    if (!prev || !next) continue;
    const key = `${prev.day}>${next.day}`;
    if (reported.has(key)) continue;
    reported.add(key);
    const rest = restBetween(prev, next);
    if (rest < limits.minRestMinutes) {
      violations.push({
        rule: "clopen",
        severity: "hard",
        detail: `Only ${hoursText(rest)} of rest ${restText(prev, next)}`,
      });
    } else if (rest < limits.preferredRestMinutes) {
      violations.push({
        rule: "short-rest",
        severity: "soft",
        detail: `${hoursText(rest)} of rest ${restText(prev, next)}, under the preferred ${hoursText(limits.preferredRestMinutes)}`,
      });
    }
  }

  return violations;
}

/**
 * Hot-path feasibility of one hypothetical assignment: the standing pattern
 * plus `candidate.range` on `candidate.day`. Any hard violation rejects in
 * every mode; soft rules relax cumulatively down the ladder (see LaborMode).
 *
 * Precondition: engine-built `ranges` are already violation-free, because the
 * engine filters every assignment through this check. The hypothetical is
 * therefore judged absolutely, never diffed against the standing pattern.
 *
 * O(occupied days): merges at most seven day lists into at most fourteen
 * slots. No minute timeline, and no violation strings are built.
 */
export function candidateAllowed(
  ranges: ReadonlyMap<Day, readonly TimeRange[]>,
  cohort: Cohort | null,
  candidate: { day: Day; range: TimeRange },
  limits: LaborLimits,
  mode: LaborMode,
): boolean {
  const days: DayStats[] = [];
  for (const day of ALL_DAYS) {
    const list = ranges.get(day) ?? [];
    const combined = day === candidate.day ? [...list, candidate.range] : list;
    if (combined.length === 0) continue;
    const stats = statsFor(day, combined);
    if (stats.merged.length > 1) return false; // split shift
    if (stats.minutes > limits.dayCapMinutes) return false; // day hours
    days.push(stats);
  }
  const slots = slotTable(days, cohort);

  for (const half of [0, 1] as const) {
    const { count, minutes } = halfTotals(slots, half);
    if (minutes > limits.weekCapMinutes) return false; // week hours
    if (count > limits.maxDaysPerWeek) return false; // days per week, hard
    if (mode !== "relax-days" && count > limits.preferredDaysPerWeek) return false; // soft
  }

  if (longestCyclicRun(slots).length > limits.maxConsecutiveDays) return false;

  for (let i = 0; i < 14; i++) {
    const prev = slots[i];
    const next = slots[(i + 1) % 14];
    if (!prev || !next) continue;
    const rest = restBetween(prev, next);
    if (rest < limits.minRestMinutes) return false; // clopen
    if (mode === "strict" && rest < limits.preferredRestMinutes) return false; // short rest
  }

  return true;
}
