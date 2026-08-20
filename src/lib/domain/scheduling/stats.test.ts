import { describe, expect, it } from "vitest";
import { computeRunStats, type RunStatsInput, type StatsStudent } from "./stats";
import type { ScheduleAssignment } from "./types";
import type { Day, ShiftBlock } from "../types";

const LEAD = "shift-lead";
const POOL = ["culinary-assistant", "cashier"];

/** 8a to 12p: the 4h block most fixtures here are built from. */
const MORNING = { start: 480, end: 720 };
const AFTERNOON = { start: 720, end: 960 };

function block(
  id: string,
  positionId: string,
  dayType: "weekday" | "weekend",
  range: { start: number; end: number } = MORNING,
  desiredCapacity: number | null = null,
): ShiftBlock {
  return { id, positionId, dayType, start: range.start, end: range.end, desiredCapacity };
}

function student(email: string, overrides: Partial<StatsStudent> = {}): StatsStudent {
  return {
    email,
    positionId: "cashier",
    international: false,
    returner: false,
    fillIn: false,
    frozen: false,
    ...overrides,
  };
}

function cell(
  studentEmail: string,
  blockId: string,
  day: Day,
  cohort: ScheduleAssignment["cohort"] = "weekday",
): ScheduleAssignment {
  return { studentEmail, blockId, day, cohort };
}

function run(input: Partial<RunStatsInput>) {
  return computeRunStats({
    assignments: [],
    blocks: [],
    students: [],
    poolPositionIds: POOL,
    leadPositionId: LEAD,
    // The shipped default unless a fixture is about the limit itself.
    maxConsecutiveDays: 5,
    ...input,
  });
}

const WEEKDAYS: Day[] = ["mon", "tue", "wed", "thu", "fri"];

describe("computeRunStats on an empty run", () => {
  const stats = run({});

  it("stamps the version", () => {
    // 4 since the coverage re-base: unstaffed floors joined the denominators,
    // building-wide counts every seat against every block, and the fairness
    // week moved to the student-flag measure (3 was `shifts` moving down into
    // the per-position rows).
    expect(stats.version).toBe(4);
  });

  it("reports zeroed distributions rather than making the caller branch", () => {
    expect(stats.fairness.people).toBe(0);
    expect(stats.fairness.weeklyMinutes).toEqual({
      count: 0,
      min: 0,
      p25: 0,
      median: 0,
      p75: 0,
      max: 0,
      mean: 0,
      pstdev: 0,
      spread: 0,
    });
    expect(stats.fairness.modalStartShareMean).toBe(0);
    expect(stats.fairness.alphaHoursCorrelation).toBeNull();
    expect(stats.stretch.consecutiveDays.buckets).toEqual({});
    expect(stats.positions).toEqual([]);
  });

  it("still lists all fourteen fortnight days", () => {
    expect(stats.perDay).toHaveLength(14);
    expect(stats.perDay.every((d) => d.people === 0 && d.minutes === 0)).toBe(true);
  });

  it("reports no coverage share at all rather than a misleading zero", () => {
    expect(stats.fragility.perPosition).toEqual([]);
    expect(stats.fragility.overallNonLead.soloShare).toBeNull();
    expect(stats.fragility.buildingWide.soloShare).toBeNull();
    expect(stats.fragility.newLeadSolo.soloShare).toBeNull();
  });

  it("has no open time and no shifts to be uncovered", () => {
    expect(stats.fragility.overallNonLead.openMinutes).toBe(0);
    expect(stats.fragility.overallNonLead.coverageShare).toBeNull();
    expect(stats.fragility.buildingWide.coverageShare).toBeNull();
    expect(stats.shifts).toEqual({ total: 0, uncovered: 0, uncoveredShare: null });
  });
});

describe("fairness distributions", () => {
  // Four people on the same 4h weekday block, working 1, 2, 3 and 4 days:
  // 240, 480, 720 and 960 cycle-averaged minutes.
  const blocks = [block("wd", "cashier", "weekday")];
  const assignments = [
    ...WEEKDAYS.slice(0, 1).map((d) => cell("a@w", "wd", d)),
    ...WEEKDAYS.slice(0, 2).map((d) => cell("b@w", "wd", d)),
    ...WEEKDAYS.slice(0, 3).map((d) => cell("c@w", "wd", d)),
    ...WEEKDAYS.slice(0, 4).map((d) => cell("d@w", "wd", d)),
  ];
  const students = ["a@w", "b@w", "c@w", "d@w"].map((e) => student(e));
  const stats = run({ blocks, assignments, students });

  it("summarizes weekly minutes by hand-checkable percentiles", () => {
    expect(stats.fairness.weeklyMinutes).toEqual({
      count: 4,
      min: 240,
      p25: 420,
      median: 600,
      p75: 780,
      max: 960,
      mean: 600,
      // deviations 360/120/120/360 -> variance 72000 -> sqrt 268.3281...
      pstdev: 268.33,
      spread: 720,
    });
  });

  it("counts the people behind the numbers, with the run's own flags", () => {
    expect(stats.fairness.people).toBe(4);
    expect(stats.fairness.frozen).toBe(0);
    expect(stats.fairness.fillIn).toBe(0);
    expect(stats.fairness.returners).toBe(0);
  });

  it("counts the placed returners, which is what the cover figures rest on", () => {
    const mixed = run({
      blocks,
      assignments,
      students: [
        student("a@w", { returner: true }),
        student("b@w"),
        student("c@w"),
        student("d@w"),
      ],
    });
    expect(mixed.fairness.returners).toBe(1);
  });

  it("finds the alphabetical bias when hours climb with the alphabet", () => {
    expect(stats.fairness.alphaHoursCorrelation).toBe(1);
  });

  it("has no correlation to report under three people", () => {
    const two = run({
      blocks,
      assignments: [cell("a@w", "wd", "mon"), cell("b@w", "wd", "mon")],
      students,
    });
    expect(two.fairness.alphaHoursCorrelation).toBeNull();
  });

  it("has none to report when everyone works the same hours", () => {
    const flat = run({
      blocks,
      assignments: ["a@w", "b@w", "c@w"].map((e) => cell(e, "wd", "mon")),
      students,
    });
    expect(flat.fairness.alphaHoursCorrelation).toBeNull();
  });

  it("counts people over their own weekly cap", () => {
    // Six 8h days is 48h averaged: over 30h domestic and over the 40h week too.
    const long = block("long", "cashier", "weekday", { start: 480, end: 960 });
    const evening = block("eve", "cashier", "weekday", { start: 960, end: 1200 });
    const heavy = run({
      blocks: [long, evening],
      assignments: [
        ...WEEKDAYS.map((d) => cell("a@w", "long", d)),
        ...WEEKDAYS.map((d) => cell("a@w", "eve", d)),
        cell("b@w", "long", "mon"),
      ],
      students: [student("a@w"), student("b@w", { international: true })],
    });
    // a@w merges 8a-8p on five weekdays: 3600 averaged minutes, 3600 per half.
    expect(heavy.fairness.weeklyMinutes.max).toBe(3600);
    expect(heavy.fairness.realizedWeekMinutes.max).toBe(3600);
    expect(heavy.fairness.overHourCap).toBe(1);
    expect(heavy.fairness.overWeekCap).toBe(1);
  });
});

describe("the realized week against the averaged week", () => {
  const blocks = [block("we", "cashier", "weekend", { start: 480, end: 960 })];
  // The rotation now comes off the STUDENT, so the every-weekend fixture carries
  // the flag rather than leaning on the cohort its rows happen to hold.
  const students = [student("ab@w"), student("ev@w", { everyWeekendOptIn: true })];
  const stats = run({
    blocks,
    assignments: [cell("ab@w", "we", "sat", "a"), cell("ev@w", "we", "sat", "every")],
    students,
  });

  it("halves an A/B Saturday on average but pays it whole in the week it lands", () => {
    // ab@w: 480 minutes every other week -> 240 averaged, 480 in the week worked.
    expect(stats.fairness.weeklyMinutes.min).toBe(240);
    expect(stats.fairness.realizedWeekMinutes.min).toBe(480);
  });

  it("leaves an every-weekend Saturday the same on both measures", () => {
    expect(stats.fairness.weeklyMinutes.max).toBe(480);
    expect(stats.fairness.realizedWeekMinutes.max).toBe(480);
  });

  it("weights a mixed weekend by the student's rotation rather than by the row", () => {
    // Rule moved: the fairness measure is the engine's own
    // `averagedAssignedMinutes` now, which weighs weekend days by the STUDENT's
    // opt-in flag. The same two rows (Saturday stamped every, Sunday stamped A)
    // read 480 for an every-weekend student and 240 for an alternating one;
    // weighting row by row used to pay them 360 whatever the roster said.
    const mixedRows = [cell("mix@w", "we", "sat", "every"), cell("mix@w", "we", "sun", "a")];
    const blocks = [block("we", "cashier", "weekend", MORNING)];
    const optedIn = run({
      blocks,
      assignments: mixedRows,
      students: [student("mix@w", { everyWeekendOptIn: true })],
    });
    const alternating = run({ blocks, assignments: mixedRows, students: [student("mix@w")] });
    expect(optedIn.fairness.weeklyMinutes.max).toBe(480);
    expect(alternating.fairness.weeklyMinutes.max).toBe(240);
    // The realized week was always right: both days land in week 1 whole.
    expect(optedIn.fairness.realizedWeekMinutes.max).toBe(480);
  });

  it("merges a day's rows before weighting it, the way the engine does", () => {
    // Rule moved: the day is merged whole and then weighted, so a hand-edited
    // Saturday holding one A row and one B row is one 8a-4p day at the halved
    // rate (240). Merging inside each cohort first paid the same day 300.
    const stats = run({
      blocks: [
        block("we-am", "cashier", "weekend", { start: 480, end: 720 }),
        block("we-mid", "cashier", "weekend", { start: 600, end: 960 }),
      ],
      assignments: [cell("a@w", "we-am", "sat", "a"), cell("a@w", "we-mid", "sat", "b")],
      students: [student("a@w")],
    });
    expect(stats.fairness.weeklyMinutes.max).toBe(240);
  });

  it("carries the student's own rotation into the hour cap count", () => {
    // Rule moved: 30h domestic cap, judged on the flag and not on the cohorts
    // the rows carry. Three 4h weekdays (720) plus two whole 12h weekend days
    // is 2160 minutes, over the 1800-minute cap. Weighting the carried A rows
    // by their own cohort read 1440 and called this person clean, while the
    // student table pilled them over their maximum off the very same flag.
    const wd = block("wd", "cashier", "weekday", MORNING);
    const we = block("we", "cashier", "weekend", { start: 480, end: 1200 });
    const capped = run({
      blocks: [wd, we],
      assignments: [
        ...WEEKDAYS.slice(0, 3).map((d) => cell("opt@w", "wd", d)),
        // Rows carried from an older run, still stamped with the A rotation.
        cell("opt@w", "we", "sat", "a"),
        cell("opt@w", "we", "sun", "a"),
      ],
      students: [student("opt@w", { everyWeekendOptIn: true })],
    });
    expect(capped.fairness.weeklyMinutes.max).toBe(2160);
    expect(capped.fairness.overHourCap).toBe(1);
  });

  it("leaves someone sitting exactly on their cap out of the count", () => {
    // The boundary `isOverMaxHours` draws, shared with the student table's pill:
    // 30h on the nose is not over 30h. Five 6h weekdays is 1800 minutes.
    const six = block("six", "cashier", "weekday", { start: 480, end: 840 });
    const exact = run({
      blocks: [six],
      assignments: WEEKDAYS.map((d) => cell("a@w", "six", d)),
      students: [student("a@w")],
    });
    expect(exact.fairness.weeklyMinutes.max).toBe(1800);
    expect(exact.fairness.overHourCap).toBe(0);
  });
});

describe("start times", () => {
  const blocks = [
    block("am", "cashier", "weekday", MORNING),
    block("pm", "cashier", "weekday", AFTERNOON),
  ];

  it("scores the modal share and welds only a repeat", () => {
    const stats = run({
      blocks,
      assignments: [
        // one@w: three shifts, two of them at 8a -> 2/3
        cell("one@w", "am", "mon"),
        cell("one@w", "am", "tue"),
        cell("one@w", "pm", "wed"),
        // two@w: two shifts, both at 8a -> welded
        cell("two@w", "am", "mon"),
        cell("two@w", "am", "tue"),
        // three@w: a single shift is trivially all at one start, but not welded
        cell("three@w", "pm", "thu"),
      ],
      students: [student("one@w"), student("two@w"), student("three@w")],
    });
    // (0.6667 + 1 + 1) / 3
    expect(stats.fairness.modalStartShareMean).toBe(0.8889);
    expect(stats.fairness.welded).toBe(1);
  });

  it("reads a staggered double as the one clock-in it is", () => {
    // 8a-12p plus 10a-4p on both days: the merged span starts at 8a each time,
    // so this person starts every worked day at the same hour. Sampling the
    // rows instead would score two starts out of four and call it 0.5.
    const stats = run({
      blocks: [
        block("am", "cashier", "weekday", MORNING),
        block("mid", "cashier", "weekday", { start: 600, end: 960 }),
      ],
      assignments: [
        cell("dbl@w", "am", "mon"),
        cell("dbl@w", "mid", "mon"),
        cell("dbl@w", "am", "tue"),
        cell("dbl@w", "mid", "tue"),
      ],
      students: [student("dbl@w")],
    });
    expect(stats.fairness.modalStartShareMean).toBe(1);
    expect(stats.fairness.welded).toBe(1);
  });

  it("leaves a single worked day out of the welded count", () => {
    // One day is trivially all at one start, so the share is an honest 1, but
    // there is no repeat to call welded.
    const stats = run({
      blocks: [
        block("am", "cashier", "weekday", MORNING),
        block("mid", "cashier", "weekday", { start: 600, end: 960 }),
      ],
      assignments: [cell("one@w", "am", "mon"), cell("one@w", "mid", "mon")],
      students: [student("one@w")],
    });
    expect(stats.fairness.modalStartShareMean).toBe(1);
    expect(stats.fairness.welded).toBe(0);
  });
});

describe("lockstep", () => {
  const blocks = [block("we", "cashier", "weekend"), block("wd", "cashier", "weekday")];

  it("groups people holding an identical set of cells", () => {
    const stats = run({
      blocks,
      assignments: [
        cell("a@w", "wd", "mon"),
        cell("a@w", "we", "sat", "a"),
        cell("b@w", "wd", "mon"),
        cell("b@w", "we", "sat", "a"),
        cell("c@w", "wd", "tue"),
      ],
      students: [student("a@w"), student("b@w"), student("c@w")],
    });
    expect(stats.fairness.lockstep).toEqual({ groups: 1, people: 2, largest: 2 });
  });

  it("does not call opposite rotation weeks lockstep", () => {
    const stats = run({
      blocks,
      assignments: [
        cell("a@w", "wd", "mon"),
        cell("a@w", "we", "sat", "a"),
        cell("b@w", "wd", "mon"),
        cell("b@w", "we", "sat", "b"),
      ],
      students: [student("a@w"), student("b@w")],
    });
    expect(stats.fairness.lockstep).toEqual({ groups: 0, people: 0, largest: 0 });
  });
});

describe("stretch over the fortnight", () => {
  const blocks = [block("wd", "cashier", "weekday"), block("we", "cashier", "weekend")];
  const everyDay = (email: string, cohort: "a" | "b" | "every") => [
    ...WEEKDAYS.map((d) => cell(email, "wd", d)),
    cell(email, "we", "sat", cohort),
    cell(email, "we", "sun", cohort),
  ];

  const stats = run({
    blocks,
    assignments: [
      ...everyDay("every@w", "every"),
      ...everyDay("ab@w", "a"),
      ...WEEKDAYS.map((d) => cell("wdonly@w", "wd", d)),
      // Saturday and Sunday of rotation B are slots 13 and 0: a run across the seam.
      cell("seam@w", "we", "sat", "b"),
      cell("seam@w", "we", "sun", "b"),
    ],
    students: ["every@w", "ab@w", "wdonly@w", "seam@w"].map((e) => student(e)),
  });

  it("reports 14 for someone who works every day of the cycle", () => {
    expect(stats.stretch.consecutiveDays.max).toBe(14);
    expect(stats.stretch.consecutiveDays.buckets["14"]).toBe(1);
  });

  it("tops an A/B student out at the structural 12", () => {
    expect(stats.stretch.consecutiveDays.buckets["12"]).toBe(1);
  });

  it("leaves a weekday-only pattern at 5, which is inside the default limit", () => {
    expect(stats.stretch.consecutiveDays.buckets["5"]).toBe(1);
    // every@w (14) and ab@w (12) are over 5; the weekday and seam patterns are not.
    expect(stats.stretch.overLimit).toBe(2);
    expect(stats.stretch.overLimitAt).toBe(5);
  });

  it("judges the same runs against the limit the run was generated under", () => {
    // The identical fixture at maxConsecutiveDays 13: only the 14-day run is
    // over, and the snapshot records the 13 it was judged against. The
    // histogram is untouched, because run lengths are not a matter of opinion.
    const roomy = run({
      blocks,
      assignments: [
        ...everyDay("every@w", "every"),
        ...everyDay("ab@w", "a"),
        ...WEEKDAYS.map((d) => cell("wdonly@w", "wd", d)),
      ],
      students: ["every@w", "ab@w", "wdonly@w"].map((e) => student(e)),
      maxConsecutiveDays: 13,
    });
    expect(roomy.stretch.overLimit).toBe(1);
    expect(roomy.stretch.overLimitAt).toBe(13);
    expect(roomy.stretch.consecutiveDays.buckets).toEqual({ "5": 1, "12": 1, "14": 1 });
  });

  it("runs a rotation B weekend across the slot 13 to slot 0 seam", () => {
    expect(stats.stretch.consecutiveDays.buckets["2"]).toBe(1);
  });

  it("counts days worked out of the fortnight's fourteen", () => {
    expect(stats.stretch.daysPerFortnight.buckets).toEqual({ "2": 1, "10": 1, "12": 1, "14": 1 });
  });

  it("splits the run lengths by weekend rotation", () => {
    const byCohort = Object.fromEntries(stats.stretch.byCohort.map((c) => [c.cohort, c]));
    expect(byCohort["every"]!.people).toBe(1);
    expect(byCohort["a"]!.people).toBe(1);
    expect(byCohort["b"]!.people).toBe(1);
    expect(byCohort["weekday"]!.people).toBe(1);
    expect(byCohort["weekday"]!.consecutiveDays.buckets).toEqual({ "5": 1 });
    expect(byCohort["every"]!.consecutiveDays.buckets).toEqual({ "14": 1 });
  });
});

describe("per position", () => {
  const blocks = [
    block("ck-wd", "cashier", "weekday", MORNING, 2),
    block("ck-we", "cashier", "weekend", AFTERNOON, 1),
    block("ba-wd", "barista", "weekday", MORNING),
  ];

  const stats = run({
    blocks,
    assignments: [
      // Monday is over target with three people; the other weekdays are empty.
      cell("a@w", "ck-wd", "mon"),
      cell("b@w", "ck-wd", "mon"),
      cell("c@w", "ck-wd", "mon"),
      // Saturday is staffed in rotation A only, so the needier week still has nobody.
      cell("a@w", "ck-we", "sat", "a"),
      cell("z@w", "ba-wd", "mon"),
    ],
    students: [
      student("a@w"),
      student("b@w"),
      student("c@w"),
      student("z@w", { positionId: "barista" }),
      student("idle@w", { positionId: "barista" }),
    ],
  });
  const byId = Object.fromEntries(stats.positions.map((p) => [p.positionId, p]));

  it("lists positions in id order", () => {
    expect(stats.positions.map((p) => p.positionId)).toEqual(["barista", "cashier"]);
  });

  it("counts staff from the roster and assignment holders separately", () => {
    expect(byId["barista"]!.staff).toBe(2);
    expect(byId["barista"]!.staffAssigned).toBe(1);
    expect(byId["cashier"]!.staff).toBe(3);
    expect(byId["cashier"]!.staffAssigned).toBe(3);
  });

  it("caps a cell's fill at its own target and grades the needier weekend week", () => {
    // 5 weekday cells at 2 plus 2 weekend cells at 1 = 12 seats asked for.
    // Monday gives 2 of 3; Saturday counts min(a, b) = 0.
    expect(byId["cashier"]!.targetedCells).toBe(7);
    expect(byId["cashier"]!.targetSeats).toBe(12);
    expect(byId["cashier"]!.filledOfTarget).toBe(2);
    expect(byId["cashier"]!.fillPercent).toBe(round4(2 / 12));
  });

  it("reports no fill percentage for a position with no targets", () => {
    expect(byId["barista"]!.targetedCells).toBe(0);
    expect(byId["barista"]!.fillPercent).toBeNull();
  });

  it("derives the span from the position's blocks", () => {
    expect(byId["cashier"]!.span).toEqual({ open: 480, close: 960 });
    expect(byId["barista"]!.span).toEqual({ open: 480, close: 720 });
  });

  it("spreads load over all fourteen days, empty ones included", () => {
    // b@w works Monday only: 240 minutes in each half, one worked day each.
    // Cashier seats land on Mon1, Mon2 (3 each) and Sat1 (1).
    expect(byId["cashier"]!.shiftsPerDay.max).toBe(3);
    expect(byId["cashier"]!.shiftsPerDay.min).toBe(0);
    expect(byId["cashier"]!.peoplePerDay.max).toBe(3);
    // 3 + 3 + 1 seats over 14 days.
    expect(byId["cashier"]!.shiftsPerDay.mean).toBe(round2(7 / 14));
  });

  it("keeps a position with targets and nobody at all in the table", () => {
    // The worst case there is: blocks asking for people, no student holding the
    // position and nothing assigned. Building the row list from seats and staff
    // alone made exactly this position disappear from the table.
    const uncovered = run({
      blocks: [
        block("ck-wd", "cashier", "weekday", MORNING, 2),
        block("gh-wd", "ghost", "weekday", MORNING, 1),
      ],
      assignments: [cell("a@w", "ck-wd", "mon")],
      students: [student("a@w")],
    });
    expect(uncovered.positions.map((p) => p.positionId)).toEqual(["cashier", "ghost"]);
    const ghost = uncovered.positions.find((p) => p.positionId === "ghost")!;
    expect(ghost).toMatchObject({
      staff: 0,
      staffAssigned: 0,
      assignments: 0,
      targetedCells: 5,
      targetSeats: 5,
      filledOfTarget: 0,
      fillPercent: 0,
    });
    expect(ghost.span).toEqual({ open: 480, close: 720 });
  });

  it("collapses to the single value at every percentile for a one-person position", () => {
    expect(byId["barista"]!.weeklyMinutes).toEqual({
      min: 240,
      mean: 240,
      median: 240,
      max: 240,
    });
    expect(byId["barista"]!.minutesPerDayWorked).toEqual({
      min: 240,
      mean: 240,
      median: 240,
      max: 240,
    });
  });
});

describe("per day", () => {
  const blocks = [block("wd", "cashier", "weekday"), block("we", "cashier", "weekend")];
  const stats = run({
    blocks,
    assignments: [
      cell("a@w", "wd", "mon"),
      cell("b@w", "wd", "mon"),
      cell("a@w", "we", "sat", "a"),
      cell("b@w", "we", "sat", "b"),
    ],
    students: [student("a@w"), student("b@w")],
  });

  it("gives the same figures to a weekday in both halves", () => {
    const mon1 = stats.perDay[1]!;
    const mon2 = stats.perDay[8]!;
    expect(mon1).toEqual({ slot: 1, day: "mon", week: 1, people: 2, minutes: 480 });
    expect(mon2).toEqual({ slot: 8, day: "mon", week: 2, people: 2, minutes: 480 });
  });

  it("splits a weekend day between the two rotation weeks", () => {
    expect(stats.perDay[6]).toEqual({ slot: 6, day: "sat", week: 1, people: 1, minutes: 240 });
    expect(stats.perDay[13]).toEqual({ slot: 13, day: "sat", week: 2, people: 1, minutes: 240 });
  });

  it("counts a person's overlapping shifts on one day only once", () => {
    const overlap = run({
      blocks: [
        block("early", "cashier", "weekday", { start: 480, end: 720 }),
        block("late", "cashier", "weekday", { start: 600, end: 960 }),
      ],
      assignments: [cell("a@w", "early", "mon"), cell("a@w", "late", "mon")],
      students: [student("a@w")],
    });
    // 8a-12p merged with 10a-4p is 8a-4p: 480 minutes, not 600.
    expect(overlap.perDay[1]!.minutes).toBe(480);
  });
});

describe("coverage fragility", () => {
  const blocks = [
    block("ca", "culinary-assistant", "weekday"),
    block("ck", "cashier", "weekday"),
    block("sl", LEAD, "weekday"),
  ];

  it("clears a floor when a returner overlaps and flags it when none does", () => {
    const stats = run({
      blocks,
      assignments: [cell("new@w", "ca", "mon"), cell("old@w", "ck", "mon")],
      students: [
        student("new@w", { positionId: "culinary-assistant" }),
        student("old@w", { returner: true }),
      ],
      poolPositionIds: [],
    });
    const byKey = Object.fromEntries(stats.fragility.perPosition.map((g) => [g.key, g]));
    expect(byKey["culinary-assistant"]!.operatingMinutes).toBe(240);
    expect(byKey["culinary-assistant"]!.soloShare).toBe(1);
    expect(byKey["cashier"]!.soloShare).toBe(0);
    // Measured floor by floor, half the operating time has no fallback.
    expect(stats.fragility.overallNonLead.soloShare).toBe(0.5);
    // In one building-wide timeline the returner overlaps the new person.
    expect(stats.fragility.buildingWide.soloShare).toBe(0);
  });

  it("lowers the solo share once the two cross-coverable positions are pooled", () => {
    const stats = run({
      blocks,
      assignments: [cell("new@w", "ca", "mon"), cell("old@w", "ck", "mon")],
      students: [
        student("new@w", { positionId: "culinary-assistant" }),
        student("old@w", { returner: true }),
      ],
      poolPositionIds: POOL,
    });
    expect(stats.fragility.perPosition.map((g) => g.key)).toEqual(["cashier+culinary-assistant"]);
    expect(stats.fragility.perPosition[0]!.soloShare).toBe(0);
    expect(stats.fragility.overallNonLead.soloShare).toBe(0);
  });

  it("counts only the minutes the returner is actually there", () => {
    const stats = run({
      blocks: [
        block("ca", "culinary-assistant", "weekday", { start: 480, end: 720 }),
        block("ca-late", "culinary-assistant", "weekday", { start: 600, end: 720 }),
      ],
      assignments: [cell("new@w", "ca", "mon"), cell("old@w", "ca-late", "mon")],
      students: [
        student("new@w", { positionId: "culinary-assistant" }),
        student("old@w", { positionId: "culinary-assistant", returner: true }),
      ],
      poolPositionIds: [],
    });
    // Operating 8a-12p (240). The returner covers 10a-12p, so 8a-10a is solo.
    expect(stats.fragility.perPosition[0]!.operatingMinutes).toBe(240);
    expect(stats.fragility.perPosition[0]!.soloMinutes).toBe(120);
    expect(stats.fragility.perPosition[0]!.soloShare).toBe(0.5);
  });

  it("keeps new shift leads out of the non-lead floors", () => {
    const stats = run({
      blocks,
      assignments: [cell("newlead@w", "sl", "mon")],
      students: [student("newlead@w", { positionId: LEAD })],
    });
    // Rule moved: floors are enumerated from the blocks, so the pooled non-lead
    // floor is listed with its open time and nobody on it. The lead is still no
    // part of it, which is what this fixture is about.
    expect(stats.fragility.perPosition.map((g) => g.key)).toEqual(["cashier+culinary-assistant"]);
    expect(stats.fragility.perPosition[0]!.operatingMinutes).toBe(0);
    expect(stats.fragility.overallNonLead.soloShare).toBeNull();
    expect(stats.fragility.newLeadSolo.soloShare).toBe(1);
  });

  it("is clean when a veteran lead overlaps the new one", () => {
    const stats = run({
      blocks,
      assignments: [cell("newlead@w", "sl", "mon"), cell("oldlead@w", "sl", "mon")],
      students: [
        student("newlead@w", { positionId: LEAD }),
        student("oldlead@w", { positionId: LEAD, returner: true }),
      ],
    });
    expect(stats.fragility.newLeadSolo.operatingMinutes).toBe(240);
    expect(stats.fragility.newLeadSolo.soloMinutes).toBe(0);
    expect(stats.fragility.newLeadSolo.soloShare).toBe(0);
  });

  it("counts a weekday floor once and each weekend rotation on its own", () => {
    const stats = run({
      blocks: [block("wd", "cashier", "weekday"), block("we", "cashier", "weekend")],
      assignments: [
        cell("new@w", "wd", "mon"),
        cell("new@w", "we", "sat", "a"),
        cell("old@w", "we", "sat", "b"),
      ],
      students: [student("new@w"), student("old@w", { returner: true })],
      poolPositionIds: [],
    });
    // Monday counts once (240) even though it is worked in both halves; each
    // Saturday rotation counts on its own (240 + 240). Solo: Monday and the A
    // Saturday, not the B one.
    expect(stats.fragility.perPosition[0]!.operatingMinutes).toBe(720);
    expect(stats.fragility.perPosition[0]!.soloMinutes).toBe(480);
  });
});

describe("open time and total coverage", () => {
  it("opens a weekday block in each of the five weekday pictures", () => {
    const stats = run({
      blocks: [block("wd", "cashier", "weekday")],
      assignments: [cell("a@w", "wd", "mon"), cell("a@w", "wd", "tue")],
      students: [student("a@w")],
      poolPositionIds: [],
    });
    const group = stats.fragility.perPosition[0]!;
    // A 4h block that runs Monday to Friday: 5 pictures of 240 minutes each.
    expect(group.openMinutes).toBe(1200);
    expect(group.operatingMinutes).toBe(480);
    expect(group.coverageShare).toBe(0.4);
  });

  it("opens a weekend block in all four weekend pictures", () => {
    const stats = run({
      blocks: [block("we", "cashier", "weekend")],
      assignments: [cell("a@w", "we", "sat", "a")],
      students: [student("a@w")],
      poolPositionIds: [],
    });
    const group = stats.fragility.perPosition[0]!;
    // Saturday and Sunday, each in both rotation weeks: 4 x 240.
    expect(group.openMinutes).toBe(960);
    expect(group.operatingMinutes).toBe(240);
    expect(group.coverageShare).toBe(0.25);
  });

  it("counts two overlapping blocks as one span of open time", () => {
    const stats = run({
      blocks: [
        block("early", "cashier", "weekday", { start: 480, end: 720 }),
        block("late", "cashier", "weekday", { start: 600, end: 960 }),
      ],
      assignments: [cell("a@w", "early", "mon")],
      students: [student("a@w")],
      poolPositionIds: [],
    });
    // 8a-12p union 10a-4p is 8a-4p: the floor is open 480 minutes a weekday,
    // not the 600 the two spans add up to.
    expect(stats.fragility.perPosition[0]!.openMinutes).toBe(2400);
    expect(stats.fragility.perPosition[0]!.coverageShare).toBe(0.1);
  });

  it("gives the pooled, summed and building-wide groups their own open time", () => {
    const stats = run({
      blocks: [
        block("ca", "culinary-assistant", "weekday", MORNING),
        block("ck", "cashier", "weekday", AFTERNOON),
        block("sl", LEAD, "weekday", { start: 480, end: 960 }),
      ],
      assignments: [cell("new@w", "ca", "mon"), cell("lead@w", "sl", "mon")],
      students: [
        student("new@w", { positionId: "culinary-assistant" }),
        student("lead@w", { positionId: LEAD }),
      ],
      poolPositionIds: POOL,
    });

    // The pooled floor opens on both its positions' blocks: 8a-12p and 12p-4p.
    const pooled = stats.fragility.perPosition[0]!;
    expect(pooled.key).toBe("cashier+culinary-assistant");
    expect(pooled.openMinutes).toBe(2400);
    expect(pooled.coverageShare).toBe(0.1);
    // One floor, so the sum is that floor.
    expect(stats.fragility.overallNonLead.openMinutes).toBe(2400);
    // Building-wide is one merged timeline on both sides: every live block and
    // every seat, the lead's included on both. 8a-4p on 5 weekdays.
    expect(stats.fragility.buildingWide.openMinutes).toBe(2400);
    // Rule moved: the lead seat counts in the numerator now, so the Monday
    // picture is the culinary 8a-12p merged with the lead's 8a-4p. Counting the
    // lead's block but not the lead's seat used to read 240 here.
    expect(stats.fragility.buildingWide.operatingMinutes).toBe(480);
    // The lead row is measured against the lead's own blocks only: its one
    // 8h Monday out of 8a-4p on five weekdays.
    expect(stats.fragility.newLeadSolo.openMinutes).toBe(2400);
    expect(stats.fragility.newLeadSolo.coverageShare).toBe(0.2);
  });

  it("keeps a floor with blocks and nobody on it in the denominator", () => {
    const stats = run({
      blocks: [block("ck", "cashier", "weekday"), block("ca", "culinary-assistant", "weekday")],
      assignments: [cell("a@w", "ck", "mon")],
      students: [student("a@w")],
      poolPositionIds: [],
    });
    const byKey = Object.fromEntries(stats.fragility.perPosition.map((g) => [g.key, g]));
    // The floor nobody works is a row of its own: open all five weekdays, with
    // no operating time for a returner share to speak about.
    expect(byKey["culinary-assistant"]).toMatchObject({
      openMinutes: 1200,
      operatingMinutes: 0,
      coverageShare: 0,
      soloShare: null,
    });
    // Two floors open 1200 minutes each and one Monday staffed on one of them:
    // 240 of 2400. Keying the groups off the seats dropped the culinary floor
    // out of the table and out of this denominator, and read 20%.
    expect(stats.fragility.overallNonLead.openMinutes).toBe(2400);
    expect(stats.fragility.overallNonLead.coverageShare).toBe(0.1);
  });

  it("counts an unstaffed pool's open time too", () => {
    const stats = run({
      blocks: [block("ca", "culinary-assistant", "weekday"), block("ba", "barista", "weekday")],
      assignments: [cell("a@w", "ba", "mon")],
      students: [student("a@w", { positionId: "barista" })],
      poolPositionIds: POOL,
    });
    const byKey = Object.fromEntries(stats.fragility.perPosition.map((g) => [g.key, g]));
    // The pool is a floor as soon as one of its positions has a block, staffed
    // or not: only culinary runs any shifts, and nobody is on them.
    expect(byKey["cashier+culinary-assistant"]).toMatchObject({
      openMinutes: 1200,
      operatingMinutes: 0,
      coverageShare: 0,
    });
    expect(stats.fragility.overallNonLead.openMinutes).toBe(2400);
    expect(stats.fragility.overallNonLead.coverageShare).toBe(0.1);
  });

  it("reaches full coverage building-wide when every block is staffed", () => {
    const stats = run({
      blocks: [
        block("ck", "cashier", "weekday"),
        block("sl", LEAD, "weekday", { start: 480, end: 960 }),
      ],
      assignments: [
        ...WEEKDAYS.map((d) => cell("a@w", "ck", d)),
        ...WEEKDAYS.map((d) => cell("lead@w", "sl", d)),
      ],
      students: [student("a@w"), student("lead@w", { positionId: LEAD })],
      poolPositionIds: [],
    });
    // Every hour the building is open has somebody on it, so the building-wide
    // row can reach 1. It could not while the lead's blocks were in the
    // denominator and the lead's seats were left out of the numerator.
    expect(stats.fragility.buildingWide.coverageShare).toBe(1);
    // The non-lead sum is the cashier floor alone, and the lead's own open time
    // is no part of it: 8a-12p covered out of 8a-12p.
    expect(stats.fragility.overallNonLead.coverageShare).toBe(1);
    expect(stats.fragility.overallNonLead.openMinutes).toBe(1200);
  });

  it("reports no coverage share where nothing is scheduled to run", () => {
    const stats = run({
      blocks: [block("wd", "cashier", "weekday")],
      assignments: [cell("a@w", "wd", "mon")],
      students: [student("a@w")],
      poolPositionIds: [],
    });
    // No Shift Lead block exists, so its row has no open time to measure and
    // says so rather than dividing by nothing.
    expect(stats.fragility.newLeadSolo.openMinutes).toBe(0);
    expect(stats.fragility.newLeadSolo.coverageShare).toBeNull();
  });
});

describe("uncovered shifts", () => {
  const stats = run({
    blocks: [
      block("wd", "cashier", "weekday"),
      block("we", "cashier", "weekend"),
      block("idle", "barista", "weekday"),
    ],
    assignments: [
      ...WEEKDAYS.map((d) => cell("a@w", "wd", d)),
      // Rotation A only: Sat1 and Sun2 are worked, Sat2 and Sun1 are not.
      cell("a@w", "we", "sat", "a"),
      cell("b@w", "we", "sun", "a"),
    ],
    students: [student("a@w"), student("b@w")],
  });

  it("counts a weekday block as five shifts and a weekend block as four", () => {
    // 5 weekday + 4 weekend + 5 for the block nobody works.
    expect(stats.shifts.total).toBe(14);
  });

  it("leaves the rotation week nobody works uncovered", () => {
    // Sat2 and Sun1 from the weekend block, plus all five of the idle block.
    expect(stats.shifts.uncovered).toBe(7);
    expect(stats.shifts.uncoveredShare).toBe(0.5);
  });

  it("covers a weekday shift in both fortnight halves at once", () => {
    const weekday = run({
      blocks: [block("wd", "cashier", "weekday")],
      assignments: [cell("a@w", "wd", "mon")],
      students: [student("a@w")],
    });
    // One Monday row covers the Monday shift, which is the same shift in both
    // halves: 5 instances, 4 of them still empty.
    expect(weekday.shifts).toEqual({ total: 5, uncovered: 4, uncoveredShare: 0.8 });
  });

  it("covers both rotation weeks with an every-weekend row", () => {
    const every = run({
      blocks: [block("we", "cashier", "weekend")],
      assignments: [cell("a@w", "we", "sat", "every"), cell("a@w", "we", "sun", "every")],
      students: [student("a@w")],
    });
    expect(every.shifts).toEqual({ total: 4, uncovered: 0, uncoveredShare: 0 });
  });

  it("counts a rotation B weekend row against the other week", () => {
    const rotationB = run({
      blocks: [block("we", "cashier", "weekend")],
      assignments: [cell("a@w", "we", "sat", "b")],
      students: [student("a@w")],
    });
    // Sat2 is worked; Sat1, Sun1 and Sun2 are not.
    expect(rotationB.shifts).toEqual({ total: 4, uncovered: 3, uncoveredShare: 0.75 });
  });

  it("splits the same instances across the positions that own the blocks", () => {
    const byId = Object.fromEntries(stats.positions.map((p) => [p.positionId, p]));
    // Cashier holds the weekday block (5, one worked day) and the weekend one
    // (4, with Sat2 and Sun1 unworked); barista holds only the idle block.
    expect(byId["cashier"]!.shifts).toEqual({ total: 9, uncovered: 2 });
    expect(byId["barista"]!.shifts).toEqual({ total: 5, uncovered: 5 });
  });

  it("makes the run-wide figure the sum of the position rows, not a second count", () => {
    // The two must agree by construction: a block belongs to one position, so
    // the rows partition the instances. Asserted so a future second enumeration
    // cannot drift from this one unnoticed.
    const sum = (pick: (p: (typeof stats.positions)[number]) => number) =>
      stats.positions.reduce((n, p) => n + pick(p), 0);
    expect(sum((p) => p.shifts.total)).toBe(stats.shifts.total);
    expect(sum((p) => p.shifts.uncovered)).toBe(stats.shifts.uncovered);
  });

  it("gives a position with blocks but no rows a full count of empty shifts", () => {
    // The case the per-position column exists for: a floor nobody is on has no
    // operating minutes for a fragility share to speak about, but it does have
    // five empty Monday-to-Friday shifts.
    const idle = run({
      blocks: [block("ba", "barista", "weekday")],
      assignments: [],
      students: [student("z@w", { positionId: "barista" })],
    });
    expect(idle.positions[0]!.shifts).toEqual({ total: 5, uncovered: 5 });
  });
});

describe("determinism and storage", () => {
  const blocks = [block("wd", "cashier", "weekday", MORNING, 2), block("sl", LEAD, "weekday")];
  const assignments = [
    cell("b@w", "wd", "tue"),
    cell("a@w", "wd", "mon"),
    cell("lead@w", "sl", "mon"),
  ];
  const students = [student("a@w"), student("b@w"), student("lead@w", { positionId: LEAD })];

  it("does not depend on the order the rows arrive in", () => {
    const forward = run({ blocks, assignments, students });
    const backward = run({
      blocks: [...blocks].reverse(),
      assignments: [...assignments].reverse(),
      students: [...students].reverse(),
    });
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it("stays a few kilobytes at full roster size", () => {
    // 400 students across 6 positions, five weekday shifts and a weekend each:
    // nothing in RunStats is per student, so the JSON must not grow with them.
    const positions = ["barista", "cashier", "culinary-assistant", "dishwasher", "stocker", LEAD];
    const bigBlocks = positions.flatMap((p) => [
      block(`${p}-wd`, p, "weekday", MORNING, 3),
      block(`${p}-we`, p, "weekend", AFTERNOON, 2),
    ]);
    const bigStudents: StatsStudent[] = [];
    const bigAssignments: ScheduleAssignment[] = [];
    for (let i = 0; i < 400; i++) {
      const email = `student${String(i).padStart(3, "0")}@wisc.edu`;
      const positionId = positions[i % positions.length]!;
      bigStudents.push(student(email, { positionId, returner: i % 3 === 0 }));
      for (let d = 0; d < 3; d++) {
        bigAssignments.push(cell(email, `${positionId}-wd`, WEEKDAYS[(i + d) % 5]!));
      }
      bigAssignments.push(cell(email, `${positionId}-we`, "sat", i % 2 === 0 ? "a" : "b"));
    }
    const json = JSON.stringify(
      run({ blocks: bigBlocks, assignments: bigAssignments, students: bigStudents }),
    );
    // Reported in the phase notes; mediumtext holds 16MB, so this is nowhere near it.
    expect(json.length).toBeLessThan(8000);
  });
});

const round2 = (n: number) => Number(n.toFixed(2));
const round4 = (n: number) => Number(n.toFixed(4));
