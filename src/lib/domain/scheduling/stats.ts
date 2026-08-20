/**
 * The statistics snapshot every run stores as `report.stats`
 * (docs/generator-constraints-fairness-plan.md §3), rendered as the Schedule
 * health section on /admin/schedule.
 *
 * This is a picture of the run AS GENERATED, taken once and frozen. The live
 * truth about a schedule is the read-time validator (./validate.ts), which
 * re-judges the rows on every page load and so sees hand edits made afterwards.
 * Nothing here is a verdict: these are counts, shares, and distributions the
 * scheduler reads to find the shape of a run.
 *
 * The fortnight is the canonical one from ./labor.ts, whose `slotIndices` this
 * module imports rather than mapping days to slots a third time (the validator
 * is the one deliberate duplicate of that mapping, and only that one).
 *
 * Two denominators recur, and they differ on purpose:
 *
 * - Anything counted per day (perDay, the position load stats, consecutive
 *   days) runs over all FOURTEEN fortnight slots, so a weekday row counts in
 *   both halves exactly as the calendar works.
 * - The fragility timelines run over the NINE distinct staffing pictures: one
 *   per weekday (both halves hold the identical row, so there is one picture)
 *   plus one per weekend day per rotation week (those really are different
 *   people). Counting a weekday twice would only scale a share by a constant;
 *   counting each distinct picture once is what "share of operating time" means.
 *
 * The distributions and histograms are parameter-free: run lengths are counted
 * as they fall, so the shape of a run reads the same whatever the knobs were.
 * `overLimit` is the one judgment here, and it is measured against the RUN'S
 * OWN consecutive-days maximum, so it agrees with the validator, which judges
 * the live rows against the same snapshotted params. `overLimitAt` stores that
 * limit beside the count, so the snapshot says what it was judged against
 * instead of leaving a later reader to guess.
 *
 * Pure and deterministic: no clock, no randomness, every ordering explicit.
 */
import { AB_WEEKEND_FACTOR } from "../capacity";
import { hourCap } from "../caps";
import { assignedCellCount } from "../coverage";
import { demandCellKey } from "../demand";
import { coveredMinutes, mergeRanges } from "../intervals";
import type { TimeRange } from "../time";
import {
  ALL_DAYS,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  dayTypeOf,
  type Day,
  type ShiftBlock,
} from "../types";
import { WEEK_CAP_MINUTES, slotIndices } from "./labor";
import type { Cohort, ScheduleAssignment } from "./types";

/** Slots in the fortnight: [Sun1, Mon1..Fri1, Sat1, Sun2, Mon2..Fri2, Sat2]. */
const FORTNIGHT_SLOTS = 14;
const MINUTES_PER_DAY = 24 * 60;

/** Bump when a field's meaning changes, so a stored snapshot stays readable. */
export const RUN_STATS_VERSION = 1;

/** One student as the statistics see them: flags only, no availability. */
export interface StatsStudent {
  email: string;
  positionId: string | null;
  international: boolean;
  /** Hired before the current cycle (`flow/returner.ts`). Everyone else is new. */
  returner: boolean;
  /** Scheduled without a response of their own. */
  fillIn: boolean;
  /** Held in place by this run. */
  frozen: boolean;
}

export interface RunStatsInput {
  assignments: readonly ScheduleAssignment[];
  blocks: readonly ShiftBlock[];
  students: readonly StatsStudent[];
  /**
   * Positions that cover for each other, measured as ONE floor in `fragility`:
   * a returner on either backs both. Unknown ids simply match nothing.
   */
  poolPositionIds: readonly string[];
  /** The Shift Lead position, whose new-lead cover is reported on its own. */
  leadPositionId: string;
  /**
   * The run's own longest-run limit, from the params it was generated under.
   * Baked in so `overLimit` agrees with the validator instead of judging every
   * run against the shipped default.
   */
  maxConsecutiveDays: number;
}

/** A sample's shape: the five-number summary plus mean, pstdev, and spread. */
export interface Distribution {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
  /** Population standard deviation (the sample IS the population here). */
  pstdev: number;
  /** max - min: the gap between the best and worst off. */
  spread: number;
}

/** The four-number summary the per-position table shows. */
export interface NumberSummary {
  min: number;
  mean: number;
  median: number;
  max: number;
}

/** Counts per whole-number value, keyed by the value (integer keys sort). */
export interface Histogram {
  buckets: Record<string, number>;
  max: number;
  mean: number;
}

export interface FairnessStats {
  /** People holding at least one assignment; every fairness figure is over these. */
  people: number;
  /** Of those, how many the run held in place and how many never responded. */
  frozen: number;
  fillIn: number;
  /**
   * Of those, how many are returners. Zero means nobody on the run has cover
   * behind them, which is what a roster with no hire dates looks like.
   */
  returners: number;
  /** Cycle-averaged weekly minutes (weekend rows halve under A/B, count whole under every). */
  weeklyMinutes: Distribution;
  /** Per person, the busier of the two fortnight halves in merged minutes. */
  realizedWeekMinutes: Distribution;
  /** People whose averaged week is over their own cap: 20h international, 30h otherwise. */
  overHourCap: number;
  /** People whose busier realized week is over the 40h payroll ceiling. */
  overWeekCap: number;
  /**
   * Mean share of a person's WORKED DAYS that begin at their most common start
   * time, read off each day's merged span. Someone working a single day sits at
   * 1, which is honest: their one day does start at one time.
   */
  modalStartShareMean: number;
  /** People working two or more days that ALL begin at the same time. */
  welded: number;
  /** People whose whole set of (day, block, rotation) cells is shared with someone else. */
  lockstep: { groups: number; people: number; largest: number };
  /**
   * Pearson r of email-sort rank against weekly minutes: the alphabetical bias
   * a static ordering leaves behind. Null under three people, or when either
   * side has no variance at all and a correlation is undefined.
   */
  alphaHoursCorrelation: number | null;
}

export interface CohortStretch {
  cohort: Cohort;
  people: number;
  consecutiveDays: Histogram;
}

export interface StretchStats {
  /** Longest cyclic run of working days over the fortnight; 14 means every day. */
  consecutiveDays: Histogram;
  /** People whose run exceeds the limit this run was generated under. */
  overLimit: number;
  /** That limit, stored so the snapshot says what `overLimit` was judged against. */
  overLimitAt: number;
  /** Working days out of the fortnight's 14 slots. */
  daysPerFortnight: Histogram;
  /** The same consecutive-days histogram split by weekend rotation. */
  byCohort: CohortStretch[];
}

export interface PositionStats {
  positionId: string;
  /** Students holding this position, whether or not the run placed them. */
  staff: number;
  /** Of those, how many hold at least one assignment in it. */
  staffAssigned: number;
  assignments: number;
  /** Distinct (block, day) cells whose block carries a target. */
  targetedCells: number;
  /** Seats those cells ask for in total. */
  targetSeats: number;
  /** Seats the run put in them, each cell capped at its own target. */
  filledOfTarget: number;
  /** filledOfTarget / targetSeats, or null when the position sets no targets. */
  fillPercent: number | null;
  /** Cycle-averaged weekly minutes per person, from this position's rows only. */
  weeklyMinutes: NumberSummary;
  /** Merged minutes of one person's one worked day, over every such day. */
  minutesPerDayWorked: NumberSummary;
  /** Earliest start and latest end across the position's blocks; null when it has none. */
  span: { open: number; close: number } | null;
  /** Assignments and distinct people per fortnight slot, empty slots included. */
  shiftsPerDay: NumberSummary;
  peoplePerDay: NumberSummary;
}

export interface PerDayStats {
  /** 0..13 across the fortnight. */
  slot: number;
  day: Day;
  /** Which W2W week the slot sits in. */
  week: 1 | 2;
  people: number;
  /** Merged minutes summed over the people on: a person's overlaps count once. */
  minutes: number;
}

/** One floor's cover: how much of its operating time has no returner on it. */
export interface FragilityGroup {
  /** Pooled positions join with "+", e.g. "cashier+culinary-assistant". */
  key: string;
  positionIds: string[];
  /** Minutes with at least one person on, across the nine staffing pictures. */
  operatingMinutes: number;
  /** Of those, minutes with only new people on and no returner overlapping. */
  soloMinutes: number;
  /** soloMinutes / operatingMinutes, or null when nothing operates. */
  soloShare: number | null;
}

export interface FragilityStats {
  /** One entry per position floor, with the pooled positions merged into one. */
  perPosition: FragilityGroup[];
  /** Those same floors added up: how fragile the non-lead positions are on their own. */
  overallNonLead: FragilityGroup;
  /** Every non-lead seat in ONE timeline: a returner anywhere in the building counts. */
  buildingWide: FragilityGroup;
  /** Inside the lead position: new leads with no veteran lead overlapping. Should be 0. */
  newLeadSolo: FragilityGroup;
}

export interface RunStats {
  version: number;
  fairness: FairnessStats;
  stretch: StretchStats;
  /** Ordered by position id. */
  positions: PositionStats[];
  /** Always 14 entries. Weekday pairs are equal by construction, and a uniform
   *  shape beats a special case for the reader and the renderer alike. */
  perDay: PerDayStats[];
  fragility: FragilityStats;
}

/** Fixed precision: keeps the stored JSON small and the numbers stable. */
const round = (n: number, places = 2): number => Number(n.toFixed(places));

/** Linear-interpolated percentile of an ascending sample (p from 0 to 1). */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Everything zero on an empty sample, so callers never branch on emptiness. */
function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) {
    return { count: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0, pstdev: 0, spread: 0 };
  }
  const min = sorted[0]!;
  const max = sorted[count - 1]!;
  const mean = sorted.reduce((n, v) => n + v, 0) / count;
  const variance = sorted.reduce((n, v) => n + (v - mean) ** 2, 0) / count;
  return {
    count,
    min: round(min),
    p25: round(percentile(sorted, 0.25)),
    median: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    max: round(max),
    mean: round(mean),
    pstdev: round(Math.sqrt(variance)),
    spread: round(max - min),
  };
}

function summary(values: readonly number[]): NumberSummary {
  const d = distribution(values);
  return { min: d.min, mean: d.mean, median: d.median, max: d.max };
}

function histogram(values: readonly number[]): Histogram {
  const buckets: Record<string, number> = {};
  let max = 0;
  let sum = 0;
  for (const v of values) {
    buckets[String(v)] = (buckets[String(v)] ?? 0) + 1;
    if (v > max) max = v;
    sum += v;
  }
  return { buckets, max, mean: values.length === 0 ? 0 : round(sum / values.length) };
}

/** Pearson r, or null when it is undefined (too few points, or no variance). */
function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return round(cov / Math.sqrt(varX * varY), 4);
}

/** Longest cyclic run of true slots; 14 when every slot is on. */
function longestRun(slots: readonly boolean[]): number {
  let best = 0;
  let current = 0;
  // The doubled scan catches a run that wraps the slot 13 to slot 0 seam.
  for (let i = 0; i < FORTNIGHT_SLOTS * 2 && best < FORTNIGHT_SLOTS; i++) {
    if (slots[i % FORTNIGHT_SLOTS]) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** One assignment row joined to its block: everything the statistics read. */
interface Seat {
  email: string;
  day: Day;
  cohort: Cohort;
  blockId: string;
  positionId: string;
  start: number;
  end: number;
  returner: boolean;
}

/**
 * The fortnight slots a seat occupies (the canonical mapping from ./labor.ts).
 * Used everywhere a day is counted.
 */
const seatSlots = (seat: Seat): number[] => slotIndices(seat.day, seat.cohort);

/**
 * The distinct staffing pictures a seat appears in. A weekday row is identical
 * in both fortnight halves, so it belongs to one picture; a weekend row belongs
 * to the rotation week (or both, under every) that actually works it.
 */
function pictureKeys(seat: Seat): number[] {
  const slots = seatSlots(seat);
  return dayTypeOf(seat.day) === "weekday" ? [slots[0]!] : slots;
}

/** The time ranges of a set of seats, as `intervals.ts` wants them. */
const toRanges = (seats: readonly Seat[]): TimeRange[] =>
  seats.map((s) => ({ start: s.start, end: s.end }));

/** Ranges per day for a set of seats. */
function rangesByDay(seats: readonly Seat[]): Map<Day, TimeRange[]> {
  const out = new Map<Day, TimeRange[]>();
  for (const s of seats) {
    const range = { start: s.start, end: s.end };
    const list = out.get(s.day);
    if (list) list.push(range);
    else out.set(s.day, [range]);
  }
  return out;
}

/** Which rotation the person is on: every beats a beats b; none means weekday only. */
function personCohort(seats: readonly Seat[]): Cohort {
  let found: Cohort = "weekday";
  for (const s of seats) {
    if (dayTypeOf(s.day) !== "weekend") continue;
    if (s.cohort === "every") return "every";
    if (s.cohort === "a") found = "a";
    else if (s.cohort === "b" && found !== "a") found = "b";
  }
  return found;
}

/**
 * Cycle-averaged weekly minutes for one person, weighted row by row: a weekend
 * day worked on rotation A or B comes round once a fortnight and counts half,
 * an every-weekend day and every weekday count whole. Collapsing the person to
 * one rotation flag would pay a mixed weekend (Saturday every, Sunday A) at the
 * every rate for both days.
 */
function averagedWeekMinutes(seats: readonly Seat[]): number {
  let total = 0;
  for (const list of groupBy(seats, (s) => `${s.day}|${s.cohort}`).values()) {
    const row = list[0]!;
    const covered = coveredMinutes(toRanges(list));
    const halved = dayTypeOf(row.day) === "weekend" && row.cohort !== "every";
    total += halved ? AB_WEEKEND_FACTOR * covered : covered;
  }
  return total;
}

/** Merged minutes behind each of the 14 fortnight slots for one person. */
function slotMinutes(seats: readonly Seat[]): number[] {
  const minutes = new Array<number>(FORTNIGHT_SLOTS).fill(0);
  for (const list of groupBy(seats, (s) => s.day).values()) {
    const covered = coveredMinutes(toRanges(list));
    for (const slot of seatSlots(list[0]!)) minutes[slot] = covered;
  }
  return minutes;
}

const NEW_BIT = 1;
const RETURNER_BIT = 2;

/**
 * One floor's operating and no-fallback minutes. A minute is operating when
 * anyone is on it, and solo when the only people on it are new: the share of
 * time with no returner to fall back on. Timelines are 1440 flags per staffing
 * picture and never leave this module.
 */
function fragilityOf(
  key: string,
  positionIds: readonly string[],
  seats: readonly Seat[],
): FragilityGroup {
  const timelines = new Map<number, Uint8Array>();
  for (const seat of seats) {
    const bit = seat.returner ? RETURNER_BIT : NEW_BIT;
    for (const picture of pictureKeys(seat)) {
      let line = timelines.get(picture);
      if (!line) {
        line = new Uint8Array(MINUTES_PER_DAY);
        timelines.set(picture, line);
      }
      for (let m = seat.start; m < seat.end; m++) line[m] = line[m]! | bit;
    }
  }
  let operatingMinutes = 0;
  let soloMinutes = 0;
  for (const line of timelines.values()) {
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const v = line[m]!;
      if (v === 0) continue;
      operatingMinutes += 1;
      if (v === NEW_BIT) soloMinutes += 1;
    }
  }
  return {
    key,
    positionIds: [...positionIds].sort(),
    operatingMinutes,
    soloMinutes,
    soloShare: operatingMinutes === 0 ? null : round(soloMinutes / operatingMinutes, 4),
  };
}

/** Add up several floors measured separately: fragility with no cross-cover. */
function sumFragility(key: string, groups: readonly FragilityGroup[]): FragilityGroup {
  const operatingMinutes = groups.reduce((n, g) => n + g.operatingMinutes, 0);
  const soloMinutes = groups.reduce((n, g) => n + g.soloMinutes, 0);
  return {
    key,
    positionIds: [...new Set(groups.flatMap((g) => g.positionIds))].sort(),
    operatingMinutes,
    soloMinutes,
    soloShare: operatingMinutes === 0 ? null : round(soloMinutes / operatingMinutes, 4),
  };
}

export function computeRunStats(input: RunStatsInput): RunStats {
  const blockById = new Map(input.blocks.map((b) => [b.id, b]));
  const studentByEmail = new Map(input.students.map((s) => [s.email, s]));

  // A row's position comes from its BLOCK, not the student: that is what was
  // actually staffed, and it stays right for a row carried from an old run.
  // An assignment on a block the config no longer holds is skipped.
  const seats: Seat[] = [];
  for (const a of input.assignments) {
    const block = blockById.get(a.blockId);
    if (!block) continue;
    seats.push({
      email: a.studentEmail,
      day: a.day,
      cohort: a.cohort,
      blockId: a.blockId,
      positionId: block.positionId,
      start: block.start,
      end: block.end,
      // Someone the run holds no student record for reads as new, the same way
      // an unknown hire date does everywhere else.
      returner: studentByEmail.get(a.studentEmail)?.returner === true,
    });
  }

  const byEmail = groupBy(seats, (s) => s.email);
  const emails = [...byEmail.keys()].sort();

  return {
    version: RUN_STATS_VERSION,
    fairness: fairnessStats(emails, byEmail, studentByEmail),
    stretch: stretchStats(emails, byEmail, input.maxConsecutiveDays),
    positions: positionStats(input, seats, studentByEmail),
    perDay: perDayStats(seats),
    fragility: fragilityStats(input, seats),
  };
}

function fairnessStats(
  emails: readonly string[],
  byEmail: ReadonlyMap<string, Seat[]>,
  studentByEmail: ReadonlyMap<string, StatsStudent>,
): FairnessStats {
  const weekly: number[] = [];
  const realized: number[] = [];
  const modalShares: number[] = [];
  let overHourCap = 0;
  let overWeekCap = 0;
  let welded = 0;
  let frozen = 0;
  let fillIn = 0;
  let returners = 0;
  const signatures = new Map<string, number>();

  for (const email of emails) {
    const seats = byEmail.get(email)!;
    const student = studentByEmail.get(email);
    if (student?.frozen) frozen += 1;
    if (student?.fillIn) fillIn += 1;
    if (student?.returner) returners += 1;

    const weeklyMinutes = averagedWeekMinutes(seats);
    weekly.push(weeklyMinutes);
    if (weeklyMinutes > hourCap(student?.international === true) * 60) overHourCap += 1;

    const minutes = slotMinutes(seats);
    const half = (h: 0 | 1) =>
      minutes.slice(h * 7, h * 7 + 7).reduce((n: number, v: number) => n + v, 0);
    const realizedMax = Math.max(half(0), half(1));
    realized.push(realizedMax);
    if (realizedMax > WEEK_CAP_MINUTES) overWeekCap += 1;

    // One sample per OCCUPIED DAY, taken from that day's merged span. A legal
    // staggered double (8a-12p plus 10a-4p) is one clock-in at 8a, not two
    // different start times, so the sample unit is the day and not the row.
    const dayStarts = [...rangesByDay(seats).values()].map((list) => mergeRanges(list)[0]!.start);
    const starts = new Map<number, number>();
    for (const start of dayStarts) starts.set(start, (starts.get(start) ?? 0) + 1);
    const modal = Math.max(...starts.values());
    const share = modal / dayStarts.length;
    modalShares.push(share);
    if (share === 1 && dayStarts.length >= 2) welded += 1;

    // The rotation is part of the signature: two people on the same cells in
    // opposite rotation weeks are covering for each other, not in lockstep.
    const signature = seats
      .map((s) => `${s.day}|${s.blockId}|${s.cohort}`)
      .sort()
      .join(",");
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
  }

  const shared = [...signatures.values()].filter((n) => n >= 2);
  const ranks = emails.map((_, i) => i);

  return {
    people: emails.length,
    frozen,
    fillIn,
    returners,
    weeklyMinutes: distribution(weekly),
    realizedWeekMinutes: distribution(realized),
    overHourCap,
    overWeekCap,
    modalStartShareMean:
      modalShares.length === 0
        ? 0
        : round(modalShares.reduce((a, b) => a + b, 0) / modalShares.length, 4),
    welded,
    lockstep: {
      groups: shared.length,
      people: shared.reduce((n, v) => n + v, 0),
      largest: shared.length === 0 ? 0 : Math.max(...shared),
    },
    alphaHoursCorrelation: pearson(ranks, weekly),
  };
}

const STRETCH_COHORTS: readonly Cohort[] = ["weekday", "a", "b", "every"];

function stretchStats(
  emails: readonly string[],
  byEmail: ReadonlyMap<string, Seat[]>,
  maxConsecutiveDays: number,
): StretchStats {
  const runs: number[] = [];
  const days: number[] = [];
  const runsByCohort = new Map<Cohort, number[]>(STRETCH_COHORTS.map((c) => [c, []]));

  for (const email of emails) {
    const seats = byEmail.get(email)!;
    const occupied = new Array<boolean>(FORTNIGHT_SLOTS).fill(false);
    for (const seat of seats) {
      for (const slot of seatSlots(seat)) occupied[slot] = true;
    }
    const run = longestRun(occupied);
    runs.push(run);
    days.push(occupied.filter(Boolean).length);
    runsByCohort.get(personCohort(seats))!.push(run);
  }

  return {
    consecutiveDays: histogram(runs),
    overLimit: runs.filter((r) => r > maxConsecutiveDays).length,
    overLimitAt: maxConsecutiveDays,
    daysPerFortnight: histogram(days),
    byCohort: STRETCH_COHORTS.map((cohort) => {
      const list = runsByCohort.get(cohort)!;
      return { cohort, people: list.length, consecutiveDays: histogram(list) };
    }),
  };
}

function positionStats(
  input: RunStatsInput,
  seats: readonly Seat[],
  studentByEmail: ReadonlyMap<string, StatsStudent>,
): PositionStats[] {
  const blocksByPosition = groupBy(input.blocks, (b) => b.positionId);
  const seatsByPosition = groupBy(seats, (s) => s.positionId);
  const staffByPosition = new Map<string, number>();
  for (const s of studentByEmail.values()) {
    if (s.positionId === null) continue;
    staffByPosition.set(s.positionId, (staffByPosition.get(s.positionId) ?? 0) + 1);
  }

  // Blocks count as much as seats and staff: a position with targets set up but
  // nobody holding it and nothing assigned is the one most worth seeing, and
  // leaving it out of the table is how a totally uncovered floor goes unnoticed.
  const ids = [
    ...new Set([...seatsByPosition.keys(), ...staffByPosition.keys(), ...blocksByPosition.keys()]),
  ].sort();
  return ids.map((positionId) => {
    const own = seatsByPosition.get(positionId) ?? [];
    const blocks = blocksByPosition.get(positionId) ?? [];
    const byPerson = groupBy(own, (s) => s.email);

    const weekly: number[] = [];
    const perDayWorked: number[] = [];
    for (const list of byPerson.values()) {
      weekly.push(averagedWeekMinutes(list));
      for (const dayList of groupBy(list, (s) => s.day).values()) {
        perDayWorked.push(coveredMinutes(toRanges(dayList)));
      }
    }

    // Load per fortnight slot, empty slots included: a position that never runs
    // on Sundays should show that in its minimum, not hide it.
    const shifts = new Array<number>(FORTNIGHT_SLOTS).fill(0);
    const peopleOn = Array.from({ length: FORTNIGHT_SLOTS }, () => new Set<string>());
    for (const seat of own) {
      for (const slot of seatSlots(seat)) {
        shifts[slot] = shifts[slot]! + 1;
        peopleOn[slot]!.add(seat.email);
      }
    }

    return {
      positionId,
      staff: staffByPosition.get(positionId) ?? 0,
      staffAssigned: byPerson.size,
      assignments: own.length,
      ...targetFill(blocks, own),
      weeklyMinutes: summary(weekly),
      minutesPerDayWorked: summary(perDayWorked),
      span:
        blocks.length === 0
          ? null
          : {
              open: Math.min(...blocks.map((b) => b.start)),
              close: Math.max(...blocks.map((b) => b.end)),
            },
      shiftsPerDay: summary(shifts),
      peoplePerDay: summary(peopleOn.map((set) => set.size)),
    };
  });
}

/**
 * Targeted-cell fill on the same terms the coverage grid grades a run: one cell
 * per (targeted block × day it runs), and a weekend cell counts the needier
 * rotation week, since the target has to hold in both.
 */
function targetFill(blocks: readonly ShiftBlock[], seats: readonly Seat[]) {
  const counts = new Map<string, { a: number; b: number }>();
  for (const seat of seats) {
    const key = demandCellKey(seat.blockId, seat.day);
    let c = counts.get(key);
    if (!c) {
      c = { a: 0, b: 0 };
      counts.set(key, c);
    }
    if (seat.cohort === "b") c.b += 1;
    else if (seat.cohort === "every") {
      c.a += 1;
      c.b += 1;
    } else c.a += 1;
  }

  let targetedCells = 0;
  let targetSeats = 0;
  let filledOfTarget = 0;
  for (const block of blocks) {
    const target = block.desiredCapacity;
    if (target == null) continue;
    for (const day of block.dayType === "weekend" ? WEEKEND_DAYS : WEEKDAY_DAYS) {
      targetedCells += 1;
      targetSeats += target;
      const filled = assignedCellCount(block.dayType, counts.get(demandCellKey(block.id, day)));
      filledOfTarget += Math.min(filled, target);
    }
  }
  return {
    targetedCells,
    targetSeats,
    filledOfTarget,
    fillPercent: targetSeats === 0 ? null : round(filledOfTarget / targetSeats, 4),
  };
}

function perDayStats(seats: readonly Seat[]): PerDayStats[] {
  const people = Array.from({ length: FORTNIGHT_SLOTS }, () => new Set<string>());
  const minutes = new Array<number>(FORTNIGHT_SLOTS).fill(0);

  for (const list of groupBy(seats, (s) => `${s.email}|${s.day}`).values()) {
    const covered = coveredMinutes(toRanges(list));
    for (const slot of seatSlots(list[0]!)) {
      people[slot]!.add(list[0]!.email);
      minutes[slot] = minutes[slot]! + covered;
    }
  }

  // ALL_DAYS is the week-1 slot order (Sun, Mon..Fri, Sat), so a slot's day is
  // fixed by its index whether or not anybody works it.
  return Array.from({ length: FORTNIGHT_SLOTS }, (_, slot) => ({
    slot,
    day: ALL_DAYS[slot % 7]!,
    week: (slot < 7 ? 1 : 2) as 1 | 2,
    people: people[slot]!.size,
    minutes: minutes[slot]!,
  }));
}

function fragilityStats(input: RunStatsInput, seats: readonly Seat[]): FragilityStats {
  const leadSeats = seats.filter((s) => s.positionId === input.leadPositionId);
  const nonLead = seats.filter((s) => s.positionId !== input.leadPositionId);

  // Pooled positions share one floor: a returner on either is real backup for
  // both. Every other position stands on its own. The pool never includes the
  // lead position, whose cover is reported separately.
  const pool = [...new Set(input.poolPositionIds)].filter((id) => id !== input.leadPositionId);
  const poolKey = [...pool].sort().join("+");
  const inPool = new Set(pool);

  const groups: FragilityGroup[] = [];
  const others = groupBy(
    nonLead.filter((s) => !inPool.has(s.positionId)),
    (s) => s.positionId,
  );
  for (const positionId of [...others.keys()].sort()) {
    groups.push(fragilityOf(positionId, [positionId], others.get(positionId)!));
  }
  const pooledSeats = nonLead.filter((s) => inPool.has(s.positionId));
  if (pooledSeats.length > 0) groups.push(fragilityOf(poolKey, pool, pooledSeats));
  groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    perPosition: groups,
    overallNonLead: sumFragility("non-lead", groups),
    buildingWide: fragilityOf("building", [...new Set(nonLead.map((s) => s.positionId))], nonLead),
    newLeadSolo: fragilityOf(input.leadPositionId, [input.leadPositionId], leadSeats),
  };
}
