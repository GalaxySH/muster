import { describe, it, expect } from "vitest";
import { parseTime, type TimeRange } from "../time";
import { ALL_DAYS, type Day } from "../types";
import {
  WEEK_CAP_MINUTES,
  candidateAllowed,
  laborLimits,
  laborViolations,
  slotIndices,
  type LaborMode,
  type LaborRule,
  type LaborViolation,
} from "./labor";
import { DEFAULT_SCHEDULING_PARAMS } from "./params";

const LIMITS = laborLimits(DEFAULT_SCHEDULING_PARAMS);

const WEEKDAYS: readonly Day[] = ["mon", "tue", "wed", "thu", "fri"];
const MODES: readonly LaborMode[] = ["strict", "relax-rest", "relax-days"];

type Span = [string, string];

const range = ([start, end]: Span): TimeRange => ({ start: parseTime(start), end: parseTime(end) });

/** Build a ranges map from "8a"/"4p" span notation. */
function ranges(spec: Partial<Record<Day, Span[]>>): Map<Day, TimeRange[]> {
  const map = new Map<Day, TimeRange[]>();
  for (const [day, spans] of Object.entries(spec) as [Day, Span[]][]) {
    map.set(day, spans.map(range));
  }
  return map;
}

/** The same single span on each of the given days. */
function daily(days: readonly Day[], span: Span): Map<Day, TimeRange[]> {
  const map = new Map<Day, TimeRange[]>();
  for (const day of days) map.set(day, [range(span)]);
  return map;
}

const cand = (day: Day, start: string, end: string) => ({ day, range: range([start, end]) });

const byRule = (violations: LaborViolation[], rule: LaborRule) =>
  violations.filter((v) => v.rule === rule);

describe("slotIndices", () => {
  it("puts a weekday day in both halves under every cohort", () => {
    const weekdaySlots: [Day, number][] = [
      ["mon", 1],
      ["tue", 2],
      ["wed", 3],
      ["thu", 4],
      ["fri", 5],
    ];
    for (const [day, d] of weekdaySlots) {
      for (const cohort of [null, "weekday", "a", "b", "every"] as const) {
        expect(slotIndices(day, cohort)).toEqual([d, d + 7]);
      }
    }
  });

  it("lands a weekend day in its rotation's half", () => {
    // Rotation a's on-weekend is the contiguous (Sat1, Sun2); b's is (Sat2, Sun1).
    expect(slotIndices("sat", "a")).toEqual([6]);
    expect(slotIndices("sun", "a")).toEqual([7]);
    expect(slotIndices("sat", "b")).toEqual([13]);
    expect(slotIndices("sun", "b")).toEqual([0]);
  });

  it("occupies all four weekend slots under every", () => {
    expect(slotIndices("sat", "every")).toEqual([6, 13]);
    expect(slotIndices("sun", "every")).toEqual([0, 7]);
  });

  it("evaluates a null or weekday cohort canonically as rotation a", () => {
    for (const cohort of [null, "weekday"] as const) {
      expect(slotIndices("sat", cohort)).toEqual([6]);
      expect(slotIndices("sun", cohort)).toEqual([7]);
    }
  });
});

describe("laborLimits", () => {
  it("derives minute limits from params and pins the 40h week cap", () => {
    expect(WEEK_CAP_MINUTES).toBe(2400);
    expect(LIMITS).toEqual({
      dayCapMinutes: 480,
      weekCapMinutes: 2400,
      maxConsecutiveDays: 5,
      maxDaysPerWeek: 6,
      preferredDaysPerWeek: 5,
      minRestMinutes: 480,
      preferredRestMinutes: 600,
    });
  });
});

describe("laborViolations", () => {
  it("accepts a Mon to Fri 8h pattern: two runs of five, 40h halves, long rests", () => {
    expect(laborViolations(daily(WEEKDAYS, ["8a", "4p"]), null, LIMITS)).toEqual([]);
  });

  it("merges touching and staggered same-day pairs into one legal shift", () => {
    const touching = ranges({
      mon: [
        ["8a", "12p"],
        ["12p", "4p"],
      ],
    });
    expect(laborViolations(touching, null, LIMITS)).toEqual([]);
    const staggered = ranges({
      mon: [
        ["10a", "2p"],
        ["1:45p", "6p"],
      ],
    });
    expect(laborViolations(staggered, null, LIMITS)).toEqual([]);
  });

  it("flags a gapped day as a split shift", () => {
    const gapped = ranges({
      mon: [
        ["8a", "12p"],
        ["2p", "6p"],
      ],
    });
    const violations = laborViolations(gapped, null, LIMITS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "split-shift", severity: "hard" });
    expect(violations[0]!.detail).toMatch(/Mon/);
  });

  it("flags a day whose merged coverage exceeds the day cap", () => {
    const violations = laborViolations(ranges({ mon: [["8a", "6p"]] }), null, LIMITS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "day-hours", severity: "hard" });
    expect(violations[0]!.detail).toMatch(/Mon/);
  });

  it("counts a dense rotation-a fortnight as a single 12-day run", () => {
    // Mon-Fri repeat in both halves; the a on-weekend (Sat1, Sun2) welds them
    // into slots 1..12.
    const violations = laborViolations(daily(ALL_DAYS, ["10a", "2p"]), "a", LIMITS);
    const runs = byRule(violations, "consecutive-days");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ severity: "hard" });
    expect(runs[0]!.detail).toMatch(/12 days/);
  });

  it("accepts a pattern whose longest run is exactly the maximum", () => {
    // Wed-Fri plus the a on-weekend is slots 3..7: a run of exactly five.
    const map = daily(["wed", "thu", "fri", "sat", "sun"], ["10a", "2p"]);
    expect(laborViolations(map, "a", LIMITS)).toEqual([]);
  });

  it("reports an all-14 every-weekend pattern as working every day", () => {
    const violations = laborViolations(daily(ALL_DAYS, ["10a", "2p"]), "every", LIMITS);
    const runs = byRule(violations, "consecutive-days");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ severity: "hard" });
    expect(runs[0]!.detail).toMatch(/every day/i);
  });

  it("joins a run across the Sat2 to Sun1 seam for rotation b", () => {
    // Occupied slots {0,1,2,4,5,8,9,11,12,13}: every linear run is 3 or less,
    // but 11,12,13 wraps into 0,1,2 for a cyclic run of 6.
    const map = daily(["sun", "mon", "tue", "thu", "fri", "sat"], ["10a", "2p"]);
    const violations = laborViolations(map, "b", LIMITS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "consecutive-days", severity: "hard" });
    expect(violations[0]!.detail).toMatch(/6 days/);
  });

  it("sees a rotation-b Sat close against the wrapped Sun open as a clopen", () => {
    const map = ranges({ sat: [["3p", "11p"]], sun: [["6a", "2p"]] });
    const violations = laborViolations(map, "b", LIMITS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "clopen", severity: "hard" });
    expect(violations[0]!.detail).toMatch(/Sat/);
    expect(violations[0]!.detail).toMatch(/Sun/);
  });

  it("grades the rotation-a on-weekend close to open by rest length", () => {
    const closeThenOpen = (open: string) =>
      laborViolations(ranges({ sat: [["3p", "11p"]], sun: [[open, "2p"]] }), "a", LIMITS);
    // 7h of rest is a clopen, 9h is only short of the preferred 10h, 10h is clean.
    expect(closeThenOpen("6a")).toMatchObject([{ rule: "clopen", severity: "hard" }]);
    expect(closeThenOpen("8a")).toMatchObject([{ rule: "short-rest", severity: "soft" }]);
    expect(closeThenOpen("9a")).toEqual([]);
    // Exactly 8h of rest sits ON the hard floor: legal there, still short of 10h.
    expect(closeThenOpen("7a")).toMatchObject([{ rule: "short-rest", severity: "soft" }]);
  });

  it("treats exactly the minimum rest as legal in candidateAllowed too", () => {
    const map = ranges({ sat: [["3p", "11p"]] });
    const candidate = cand("sun", "7a", "2p"); // 8h of rest on the nose
    expect(candidateAllowed(map, "a", candidate, LIMITS, "strict")).toBe(false);
    expect(candidateAllowed(map, "a", candidate, LIMITS, "relax-rest")).toBe(true);
  });

  it("wraps a Sun close into the Mon open of the weekday template", () => {
    const map = ranges({ sun: [["3p", "11p"]], mon: [["6a", "2p"]] });
    const violations = laborViolations(map, "a", LIMITS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "clopen", severity: "hard" });
    expect(violations[0]!.detail).toMatch(/Sun/);
    expect(violations[0]!.detail).toMatch(/Mon/);
  });

  it("reports a weekday rest pair once, not once per half", () => {
    const map = ranges({ mon: [["2p", "10p"]], tue: [["7a", "1p"]] });
    const violations = laborViolations(map, null, LIMITS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "short-rest", severity: "soft" });
  });

  it("flags the half whose merged minutes exceed the 40h cap", () => {
    // Mon-Fri at 8h is 40h in each half; the rotation-a Saturday pushes only
    // week 1 over the cap.
    const map = ranges({
      mon: [["8a", "4p"]],
      tue: [["8a", "4p"]],
      wed: [["8a", "4p"]],
      thu: [["8a", "4p"]],
      fri: [["8a", "4p"]],
      sat: [["10a", "6p"]],
    });
    const over = byRule(laborViolations(map, "a", LIMITS), "week-hours");
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ severity: "hard" });
    expect(over[0]!.detail).toMatch(/Week 1/);
  });

  it("marks a sixth day in one half as soft over the preferred five", () => {
    // Rotation b's Sunday joins Mon-Fri in week 1. Consecutive days is raised
    // so only the day count fires.
    const map = daily(["sun", ...WEEKDAYS], ["10a", "2p"]);
    const violations = laborViolations(map, "b", { ...LIMITS, maxConsecutiveDays: 7 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "days-per-week", severity: "soft" });
    expect(violations[0]!.detail).toMatch(/Week 1/);
  });

  it("marks seven days in a half as hard, reachable only for every", () => {
    const map = daily(ALL_DAYS, ["10a", "2p"]);
    const violations = laborViolations(map, "every", { ...LIMITS, maxConsecutiveDays: 14 });
    expect(violations).toHaveLength(2);
    for (const v of violations) {
      expect(v).toMatchObject({ rule: "days-per-week", severity: "hard" });
    }
    expect(violations.map((v) => v.detail).join(" ")).toMatch(/Week 1[\s\S]*Week 2/);
  });
});

describe("candidateAllowed", () => {
  it("judges a weekend candidate identically under rotation a and b (symmetry lemma)", () => {
    const cases: { map: Map<Day, TimeRange[]>; candidate: { day: Day; range: TimeRange } }[] = [
      // Dense symmetric weekdays; the sixth day trips hard rules either way.
      { map: daily(WEEKDAYS, ["10a", "2p"]), candidate: cand("sat", "10a", "2p") },
      // Asymmetric weekday ranges with a clean Sunday candidate.
      {
        map: ranges({ mon: [["8a", "4p"]], wed: [["12p", "8p"]], fri: [["2p", "10p"]] }),
        candidate: cand("sun", "8a", "2p"),
      },
      // A Friday close that makes the Saturday open a clopen in either half.
      {
        map: ranges({ fri: [["3p", "11p"]], mon: [["10a", "2p"]] }),
        candidate: cand("sat", "6a", "2p"),
      },
      // A 9.5h rest: soft, so the mode decides, but never the rotation.
      { map: ranges({ fri: [["1p", "9p"]] }), candidate: cand("sat", "6:30a", "2p") },
    ];
    for (const { map, candidate } of cases) {
      for (const mode of MODES) {
        const underA = candidateAllowed(map, "a", candidate, LIMITS, mode);
        expect(candidateAllowed(map, "b", candidate, LIMITS, mode)).toBe(underA);
        expect(candidateAllowed(map, null, candidate, LIMITS, mode)).toBe(underA);
      }
    }
  });

  it("accepts a clean candidate in strict mode", () => {
    expect(candidateAllowed(new Map(), null, cand("mon", "8a", "4p"), LIMITS, "strict")).toBe(true);
    const oneDay = ranges({ mon: [["8a", "12p"]] });
    // A touching extension merges into one shift instead of splitting the day.
    expect(candidateAllowed(oneDay, null, cand("mon", "12p", "4p"), LIMITS, "strict")).toBe(true);
    const twoDays = daily(["mon", "tue"], ["8a", "4p"]);
    expect(candidateAllowed(twoDays, null, cand("wed", "8a", "4p"), LIMITS, "strict")).toBe(true);
  });

  it("tolerates a short rest from relax-rest down, never in strict", () => {
    const map = ranges({ mon: [["2p", "10p"]] });
    const candidate = cand("tue", "7a", "1p"); // 9h of rest: past the floor, short of preferred
    expect(candidateAllowed(map, null, candidate, LIMITS, "strict")).toBe(false);
    expect(candidateAllowed(map, null, candidate, LIMITS, "relax-rest")).toBe(true);
    expect(candidateAllowed(map, null, candidate, LIMITS, "relax-days")).toBe(true);
  });

  it("tolerates a sixth day only in relax-days", () => {
    const map = daily(WEEKDAYS, ["10a", "2p"]);
    const candidate = cand("sat", "10a", "2p");
    const limits = { ...LIMITS, maxConsecutiveDays: 7 };
    expect(candidateAllowed(map, "a", candidate, limits, "strict")).toBe(false);
    expect(candidateAllowed(map, "a", candidate, limits, "relax-rest")).toBe(false);
    expect(candidateAllowed(map, "a", candidate, limits, "relax-days")).toBe(true);
  });

  it("rejects a clopen in every mode", () => {
    const map = ranges({ fri: [["3p", "11p"]] });
    for (const mode of MODES) {
      expect(candidateAllowed(map, "a", cand("sat", "6a", "2p"), LIMITS, mode)).toBe(false);
    }
  });

  it("rejects a day pushed past the day cap in every mode", () => {
    const map = ranges({ mon: [["8a", "4p"]] });
    for (const mode of MODES) {
      expect(candidateAllowed(map, null, cand("mon", "2p", "6p"), LIMITS, mode)).toBe(false);
    }
  });

  it("rejects a split shift in every mode", () => {
    const map = ranges({ mon: [["8a", "12p"]] });
    for (const mode of MODES) {
      expect(candidateAllowed(map, null, cand("mon", "5p", "9p"), LIMITS, mode)).toBe(false);
    }
  });

  it("rejects a half pushed past the 40h cap in every mode", () => {
    const map = daily(WEEKDAYS, ["8a", "4p"]);
    // Day-count and run limits are loosened so only the week cap can reject.
    const limits = {
      ...LIMITS,
      maxConsecutiveDays: 14,
      maxDaysPerWeek: 7,
      preferredDaysPerWeek: 7,
    };
    for (const mode of MODES) {
      expect(candidateAllowed(map, "a", cand("sat", "10a", "6p"), limits, mode)).toBe(false);
    }
  });

  it("rejects a run past the consecutive-days limit in every mode", () => {
    const map = daily(WEEKDAYS, ["10a", "2p"]);
    // Day counts are loosened so only the 6-slot run can reject.
    const limits = { ...LIMITS, maxDaysPerWeek: 7, preferredDaysPerWeek: 7 };
    for (const mode of MODES) {
      expect(candidateAllowed(map, "a", cand("sat", "10a", "2p"), limits, mode)).toBe(false);
    }
  });
});
