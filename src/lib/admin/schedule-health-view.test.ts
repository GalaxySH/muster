import { describe, expect, it } from "vitest";
import {
  computeRunStats,
  RUN_STATS_VERSION,
  type RunStats,
  type StatsStudent,
} from "@/lib/domain/scheduling/stats";
import type { ScheduleAssignment } from "@/lib/domain/scheduling/types";
import type { Day, ShiftBlock } from "@/lib/domain/types";
import { buildScheduleHealthView, isReadableRunStats } from "./schedule-health-view";

const LEAD = "shift-lead";
const NAMES = new Map([
  [LEAD, "Shift Lead"],
  ["cashier", "Cashier"],
  ["culinary-assistant", "Culinary Assistant"],
  ["barista", "Barista"],
]);

const WEEKDAYS: Day[] = ["mon", "tue", "wed", "thu", "fri"];

function block(
  id: string,
  positionId: string,
  start = 480,
  end = 720,
  desiredCapacity: number | null = null,
): ShiftBlock {
  return { id, positionId, dayType: "weekday", start, end, desiredCapacity };
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

const cell = (studentEmail: string, blockId: string, day: Day): ScheduleAssignment => ({
  studentEmail,
  blockId,
  day,
  cohort: "weekday",
});

function statsFor(input: {
  blocks: ShiftBlock[];
  assignments: ScheduleAssignment[];
  students: StatsStudent[];
  poolPositionIds?: string[];
  maxConsecutiveDays?: number;
}): RunStats {
  return computeRunStats({
    blocks: input.blocks,
    assignments: input.assignments,
    students: input.students,
    poolPositionIds: input.poolPositionIds ?? [],
    leadPositionId: LEAD,
    // The shipped default unless a fixture is about the limit itself.
    maxConsecutiveDays: input.maxConsecutiveDays ?? 5,
  });
}

/** Every string the view puts on screen, keys excluded. */
function renderedStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(renderedStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(renderedStrings);
  }
  return [];
}

const emptyView = () =>
  buildScheduleHealthView(
    statsFor({ blocks: [], assignments: [], students: [] }),
    new Map<string, string>(),
  );

describe("buildScheduleHealthView on an empty run", () => {
  const view = emptyView();

  it("reports nobody and leaves the charts empty", () => {
    expect(view.people).toBe(0);
    expect(view.consecutiveDays).toEqual([]);
    expect(view.daysWorked).toEqual([]);
    expect(view.cohortLines).toEqual([]);
    expect(view.positions).toEqual([]);
    expect(view.notes).toEqual([]);
  });

  it("still lays out the whole fortnight, every cell quiet", () => {
    // The table keeps its shape with nobody in it: the section above it is what
    // says the run placed nobody, not a table that silently shrinks.
    expect(view.perDay.days).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(view.perDay.rows.map((r) => r.week)).toEqual(["Week 1", "Week 2"]);
    for (const row of view.perDay.rows) expect(row.cells).toEqual(Array(7).fill("-"));
  });

  it("says a share cannot be measured rather than showing a zero", () => {
    const byLabel = Object.fromEntries(view.tiles.map((t) => [t.label, t]));
    // Tile relabelled by the copy pass: "No returner on" read as a truncated
    // sentence, so it now names the thing it measures.
    expect(byLabel["Time with no returner"]!.value).toBe("n/a");
    expect(byLabel["New leads alone"]!.value).toBe("n/a");
    expect(byLabel["New leads alone"]!.tone).toBeNull();
    expect(byLabel["Hours spread"]!.sub).toBe("nobody was placed");
  });

  it("still lists every fragility row, marked as not running", () => {
    expect(view.fragility.map((r) => r.label)).toEqual([
      "All positions",
      "Anyone in the building",
      "New shift leads",
    ]);
    for (const row of view.fragility) {
      // The figure and the bar are total coverage now, so with no blocks at all
      // there is no open time to measure and the row reads n/a on both counts.
      expect(row.coverage).toBe("n/a");
      expect(row.coveragePercent).toBeNull();
      expect(row.detail).toBe("nobody is on");
      expect(row.pill).toBe("");
    }
  });

  it("never writes an em dash", () => {
    expect(JSON.stringify(view)).not.toMatch(/—/);
  });
});

describe("the headline tiles", () => {
  // Four cashiers on a 4h block working 1, 2, 3 and 4 days: 4h to 16h a week.
  const stats = statsFor({
    blocks: [block("wd", "cashier")],
    assignments: [
      ...WEEKDAYS.slice(0, 1).map((d) => cell("a@w", "wd", d)),
      ...WEEKDAYS.slice(0, 2).map((d) => cell("b@w", "wd", d)),
      ...WEEKDAYS.slice(0, 3).map((d) => cell("c@w", "wd", d)),
      ...WEEKDAYS.slice(0, 4).map((d) => cell("d@w", "wd", d)),
    ],
    students: ["a@w", "b@w", "c@w", "d@w"].map((e) => student(e)),
  });
  const view = buildScheduleHealthView(stats, NAMES);
  const byLabel = Object.fromEntries(view.tiles.map((t) => [t.label, t]));

  it("formats hours the way the rest of the admin pages do", () => {
    expect(byLabel["Hours spread"]!.value).toBe("12h");
    expect(byLabel["Hours spread"]!.sub).toBe("4h to 16h");
    expect(byLabel["Standard deviation"]!.value).toBe("4.5h");
    expect(byLabel["Standard deviation"]!.sub).toBe("average 10h");
  });

  it("warns when anyone works every shift at one start time", () => {
    // Everyone works the same 8a block, so every worked day starts at 8a. a@w
    // works one day and the two-worked-days guard leaves them out, so three of
    // the four are welded.
    expect(byLabel["Same start time"]!.value).toBe("100%");
    expect(byLabel["Same start time"]!.tone).toBe("warning");
    expect(byLabel["Same start time"]!.sub).toBe("3 people start every shift at one time");
  });

  it("mentions the alphabetical bias when hours track the alphabet", () => {
    expect(view.notes).toContainEqual({
      text: "Hours line up with alphabetical order (correlation 1).",
      tone: null,
    });
  });

  it("scales the hours ladder against the run's own top", () => {
    expect(view.hours.map((b) => [b.label, b.caption, b.percent])).toEqual([
      ["Lowest", "4h", 25],
      ["25th", "7h", 44],
      ["Median", "10h", 63],
      ["75th", "13h", 81],
      ["Highest", "16h", 100],
    ]);
  });
});

describe("the consecutive-days bars", () => {
  const stats = statsFor({
    blocks: [block("wd", "cashier"), block("we", "cashier")],
    assignments: [
      ...WEEKDAYS.map((d) => cell("five@w", "wd", d)),
      ...WEEKDAYS.map((d) => cell("six@w", "wd", d)),
      { studentEmail: "six@w", blockId: "we", day: "sat", cohort: "a" },
    ],
    students: [student("five@w"), student("six@w")],
  });
  const view = buildScheduleHealthView(stats, NAMES);

  it("orders shortest run first and scales to the busiest bucket", () => {
    expect(view.consecutiveDays).toEqual([
      { label: "5 days", percent: 100, caption: "1 · 50%", tone: null },
      { label: "6 days", percent: 100, caption: "1 · 50%", tone: "warning" },
    ]);
  });

  it("says so in the notes when anyone runs past the limit", () => {
    expect(view.notes).toContainEqual({
      text: "1 person works more than 5 days in a row.",
      tone: "warning",
    });
  });

  it("speaks the run's own limit, not the shipped default", () => {
    // Same six-day run under maxConsecutiveDays 7: the labor validator on this
    // page says nothing about it, so neither does the health section.
    const roomy = buildScheduleHealthView(
      statsFor({
        blocks: [block("wd", "cashier"), block("we", "cashier")],
        assignments: [
          ...WEEKDAYS.map((d) => cell("six@w", "wd", d)),
          { studentEmail: "six@w", blockId: "we", day: "sat", cohort: "a" },
        ],
        students: [student("six@w")],
        maxConsecutiveDays: 7,
      }),
      NAMES,
    );
    expect(roomy.notes.map((n) => n.text)).not.toContainEqual(
      expect.stringContaining("days in a row"),
    );
    expect(roomy.consecutiveDays).toEqual([
      { label: "6 days", percent: 100, caption: "1 · 100%", tone: null },
    ]);
  });

  it("names the limit it judged against when a run does pass it", () => {
    const tight = buildScheduleHealthView(
      statsFor({
        blocks: [block("wd", "cashier")],
        assignments: WEEKDAYS.map((d) => cell("five@w", "wd", d)),
        students: [student("five@w")],
        maxConsecutiveDays: 3,
      }),
      NAMES,
    );
    expect(tight.notes).toContainEqual({
      text: "1 person works more than 3 days in a row.",
      tone: "warning",
    });
    expect(tight.consecutiveDays[0]!.tone).toBe("warning");
  });
});

// A fortnight with all four rotations on it, so the days-worked bars, the
// rotation lines and the day-by-day table all have something asymmetric to say.
describe("days worked, rotations, and the fortnight day by day", () => {
  const weekendBlock = (id: string, positionId: string): ShiftBlock => ({
    id,
    positionId,
    dayType: "weekend",
    start: 480,
    end: 720,
    desiredCapacity: null,
  });
  const weCell = (
    studentEmail: string,
    day: Day,
    cohort: ScheduleAssignment["cohort"],
  ): ScheduleAssignment => ({ studentEmail, blockId: "we", day, cohort });

  const view = buildScheduleHealthView(
    statsFor({
      blocks: [block("wd", "cashier"), weekendBlock("we", "cashier")],
      assignments: [
        // Weekday only: ten of the fourteen slots, five in a row.
        ...WEEKDAYS.map((d) => cell("wk@w", "wd", d)),
        // One Monday each, plus a weekend day on their own rotation.
        cell("a@w", "wd", "mon"),
        weCell("a@w", "sat", "a"),
        cell("b@w", "wd", "mon"),
        weCell("b@w", "sun", "b"),
        // Every weekend: both weekend days in both rotation weeks.
        weCell("ev@w", "sat", "every"),
        weCell("ev@w", "sun", "every"),
      ],
      // The every-weekend student carries the rotation flag their rows imply:
      // weekend minutes are weighted off the student now, not off the row.
      students: [
        student("wk@w"),
        student("a@w"),
        student("b@w"),
        student("ev@w", { everyWeekendOptIn: true }),
      ],
    }),
    NAMES,
  );

  it("bars the days-worked histogram shortest first, with no tone on it", () => {
    // Days out of fourteen: 10, 3, 3, 4. Nothing here is a rule anyone can
    // break, so unlike the days-in-a-row column nothing is toned.
    expect(view.daysWorked).toEqual([
      { label: "3 days", percent: 100, caption: "2 · 50%", tone: null },
      { label: "4 days", percent: 50, caption: "1 · 25%", tone: null },
      { label: "10 days", percent: 50, caption: "1 · 25%", tone: null },
    ]);
  });

  it("summarises each rotation present in one line", () => {
    expect(view.cohortLines).toEqual([
      "Weekdays only: 1 person, longest 5 days",
      "A rotation: 1 person, longest 1 day",
      "B rotation: 1 person, longest 2 days",
      "Every weekend: 1 person, longest 2 days",
    ]);
  });

  it("leaves out a rotation nobody is on", () => {
    const weekdaysOnly = buildScheduleHealthView(
      statsFor({
        blocks: [block("wd", "cashier")],
        assignments: [cell("a@w", "wd", "mon")],
        students: [student("a@w")],
      }),
      NAMES,
    );
    expect(weekdaysOnly.cohortLines).toEqual(["Weekdays only: 1 person, longest 1 day"]);
  });

  it("reads the fortnight table by slot, so the two weeks stay apart", () => {
    // Only the weekend rows can tell the halves apart: a weekday row is the
    // same shift in both. Sunday of week 1 holds the B rotation and the
    // every-weekend person, Sunday of week 2 only the latter.
    expect(view.perDay.days).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(view.perDay.rows).toEqual([
      {
        week: "Week 1",
        cells: ["2 · 8h", "3 · 12h", "1 · 4h", "1 · 4h", "1 · 4h", "1 · 4h", "2 · 8h"],
      },
      {
        week: "Week 2",
        cells: ["1 · 4h", "3 · 12h", "1 · 4h", "1 · 4h", "1 · 4h", "1 · 4h", "1 · 4h"],
      },
    ]);
  });
});

describe("the fragility table", () => {
  const blocks = [
    block("ca", "culinary-assistant"),
    block("ck", "cashier"),
    block("sl", LEAD),
    block("ba", "barista"),
  ];

  it("tones a floor by how much of its time has no returner", () => {
    // Barista: one new person all morning, nobody else. Cashier: a returner.
    const view = buildScheduleHealthView(
      statsFor({
        blocks,
        assignments: [cell("new@w", "ba", "mon"), cell("old@w", "ck", "mon")],
        students: [
          student("new@w", { positionId: "barista" }),
          student("old@w", { returner: true }),
        ],
      }),
      NAMES,
    );
    const byLabel = Object.fromEntries(view.fragility.map((r) => [r.label, r]));
    expect(byLabel["Barista"]).toMatchObject({
      // The bar is total coverage now: one Monday staffed out of a block that
      // runs all five weekdays. The returner figure moved to the detail column,
      // and it alone still decides the tone and the pill.
      coverage: "20%",
      coveragePercent: 20,
      // A share, not "4h of 4h staffed": these are picture-minutes, one per
      // distinct staffing day, so they are not calendar hours.
      detail: "100% of staffed time with no returner",
      tone: "danger",
      pill: "fragile",
    });
    expect(byLabel["Cashier"]).toMatchObject({
      coverage: "20%",
      detail: "0% of staffed time with no returner",
      tone: null,
      pill: "covered",
    });
    expect(byLabel["All positions"]).toMatchObject({
      // Rule moved: a floor with blocks and nobody on it is a row too, so the
      // unstaffed Culinary Assistant floor is in this denominator now. Three
      // floors open five weekdays each, two of them staffed one Monday: 480 of
      // 3600. The returner share beside it is over the staffed time and is
      // untouched by the empty floor.
      coverage: "13%",
      detail: "50% of staffed time with no returner",
    });
    // The floor nobody is on says so plainly rather than being left out.
    expect(byLabel["Culinary Assistant"]).toMatchObject({
      coverage: "0%",
      coveragePercent: 0,
      detail: "nobody is on",
      pill: "",
    });
    // One shared timeline on both sides: every block in the building opens the
    // same 8a to 12p, and the returner overlaps the new person everywhere in it.
    expect(byLabel["Anyone in the building"]).toMatchObject({
      coverage: "20%",
      detail: "0% of staffed time with no returner",
      pill: "covered",
    });
  });

  it("names a pooled floor by both its positions", () => {
    const view = buildScheduleHealthView(
      statsFor({
        blocks,
        assignments: [cell("new@w", "ca", "mon"), cell("old@w", "ck", "mon")],
        students: [
          student("new@w", { positionId: "culinary-assistant" }),
          student("old@w", { returner: true }),
        ],
        poolPositionIds: ["culinary-assistant", "cashier"],
      }),
      NAMES,
    );
    // Rule moved: the Barista floor has a block and nobody on it, so it is a row
    // now and it sorts ahead of the pool. The naming is what this fixture is
    // about, so the row is read by name rather than by position.
    expect(view.fragility.map((r) => r.label)).toContain("Cashier + Culinary Assistant");
    const pooled = view.fragility.find((r) => r.label === "Cashier + Culinary Assistant")!;
    expect(pooled.tone).toBeNull();
  });

  it("marks any new lead left without a veteran, however small the share", () => {
    // The new lead is alone for 10 minutes out of a four hour lead shift.
    const view = buildScheduleHealthView(
      statsFor({
        blocks: [block("sl", LEAD, 480, 720), block("sl-late", LEAD, 490, 720)],
        assignments: [cell("newlead@w", "sl", "mon"), cell("oldlead@w", "sl-late", "mon")],
        students: [
          student("newlead@w", { positionId: LEAD }),
          student("oldlead@w", { positionId: LEAD, returner: true }),
        ],
      }),
      NAMES,
    );
    const lead = view.fragility.find((r) => r.label === "New shift leads")!;
    // The lead row keeps its own vocabulary in the detail column, which is where
    // the returner figure lives now; the bold figure beside it is coverage.
    expect(lead.detail).toBe("4% of lead time with no veteran on");
    expect(lead.coverage).toBe("20%");
    expect(lead.tone).toBe("danger");
    expect(lead.pill).toBe("fragile");
    const tile = view.tiles.find((t) => t.label === "New leads alone")!;
    expect(tile.tone).toBe("danger");
    // Reads as a share, not "0.2h": the same picture-minutes rule as the rows.
    expect(tile.sub).toBe("of lead time with no veteran on");
  });

  it("clears the lead row when a veteran always overlaps", () => {
    const view = buildScheduleHealthView(
      statsFor({
        blocks,
        assignments: [cell("newlead@w", "sl", "mon"), cell("oldlead@w", "sl", "mon")],
        students: [
          student("newlead@w", { positionId: LEAD }),
          student("oldlead@w", { positionId: LEAD, returner: true }),
        ],
      }),
      NAMES,
    );
    const lead = view.fragility.find((r) => r.label === "New shift leads")!;
    // Same move: the no-veteran figure reads out of the detail column now.
    expect(lead).toMatchObject({
      detail: "0% of lead time with no veteran on",
      tone: null,
      pill: "covered",
    });
    expect(view.tiles.find((t) => t.label === "New leads alone")!.sub).toBe(
      "a veteran lead always overlaps",
    );
  });

  it("warns between a tenth and a fifth of staffed time", () => {
    // 8a-12p operating; the returner covers 8a-11:30p, leaving 30 of 240 (12.5%).
    const view = buildScheduleHealthView(
      statsFor({
        blocks: [block("ba", "barista", 480, 720), block("ba-early", "barista", 480, 690)],
        assignments: [cell("new@w", "ba", "mon"), cell("old@w", "ba-early", "mon")],
        students: [
          student("new@w", { positionId: "barista" }),
          student("old@w", { positionId: "barista", returner: true }),
        ],
      }),
      NAMES,
    );
    // The returner share is what the tone reads, and it reads it from the detail.
    expect(view.fragility[0]).toMatchObject({
      detail: "13% of staffed time with no returner",
      tone: "warning",
      pill: "thin",
    });
  });

  /** One barista on 8a-12p with a returner covering from `coverFrom` on. */
  const soloShareOf = (coverFrom: number) =>
    buildScheduleHealthView(
      statsFor({
        blocks: [block("ba", "barista", 480, 720), block("ba-cover", "barista", coverFrom, 720)],
        assignments: [cell("new@w", "ba", "mon"), cell("old@w", "ba-cover", "mon")],
        students: [
          student("new@w", { positionId: "barista" }),
          student("old@w", { positionId: "barista", returner: true }),
        ],
      }),
      NAMES,
    ).fragility[0]!;

  it("keeps exactly a fifth on the warning side of danger", () => {
    // 48 solo minutes of 240: 0.20 on the nose. The rule is "over a fifth", so
    // the boundary itself is a warning and nothing worse. Read off the detail
    // column, which is where the returner share moved.
    const row = soloShareOf(528);
    expect(row.detail).toBe("20% of staffed time with no returner");
    expect(row.tone).toBe("warning");
    expect(row.pill).toBe("thin");
  });

  it("keeps exactly a tenth clear of the warning", () => {
    // 24 solo minutes of 240: 0.10 on the nose, and the rule is "over a tenth".
    const row = soloShareOf(504);
    expect(row.detail).toBe("10% of staffed time with no returner");
    expect(row.tone).toBeNull();
    expect(row.pill).toBe("covered");
  });
});

describe("the cover bars against the returner figures", () => {
  it("keeps the coverage figure clear of the tone the returner share sets", () => {
    // Two floors staffed identically, one Monday out of a five-weekday block:
    // both read 20% coverage, and only the returner column tells them apart.
    const view = buildScheduleHealthView(
      statsFor({
        blocks: [block("ba", "barista"), block("ck", "cashier")],
        assignments: [cell("new@w", "ba", "mon"), cell("old@w", "ck", "mon")],
        students: [
          student("new@w", { positionId: "barista" }),
          student("old@w", { returner: true }),
        ],
      }),
      NAMES,
    );
    const byLabel = Object.fromEntries(view.fragility.map((r) => [r.label, r]));
    expect(byLabel["Barista"]!.coveragePercent).toBe(20);
    expect(byLabel["Cashier"]!.coveragePercent).toBe(20);
    expect(byLabel["Barista"]!.tone).toBe("danger");
    expect(byLabel["Cashier"]!.tone).toBeNull();
  });

  it("draws no bar for a floor that is never scheduled to run", () => {
    // Nobody holds the Shift Lead position and no lead block exists, so the row
    // has no open time behind it: "n/a" and no bar, rather than an empty 0%.
    const view = buildScheduleHealthView(
      statsFor({
        blocks: [block("ck", "cashier")],
        assignments: [cell("a@w", "ck", "mon")],
        students: [student("a@w")],
      }),
      NAMES,
    );
    const lead = view.fragility.find((r) => r.label === "New shift leads")!;
    expect(lead.coverage).toBe("n/a");
    expect(lead.coveragePercent).toBeNull();
    expect(lead.detail).toBe("nobody is on");
  });
});

describe("the uncovered-shifts tile", () => {
  const tileFor = (input: Parameters<typeof statsFor>[0]) =>
    buildScheduleHealthView(statsFor(input), NAMES).tiles.find(
      (t) => t.label === "Uncovered shifts",
    )!;

  it("counts the shift instances nobody is on", () => {
    // One weekday block covered on Monday only: 5 instances, 4 empty.
    const tile = tileFor({
      blocks: [block("ck", "cashier")],
      assignments: [cell("a@w", "ck", "mon")],
      students: [student("a@w")],
    });
    expect(tile.value).toBe("80%");
    expect(tile.sub).toBe("4 of 5 shifts have nobody on");
    // Informational: the coverage grids own the target-based alarms.
    expect(tile.tone).toBeNull();
  });

  it("says has, not have, for a single empty shift", () => {
    const tile = tileFor({
      blocks: [block("ck", "cashier")],
      assignments: WEEKDAYS.slice(0, 4).map((d) => cell("a@w", "ck", d)),
      students: [student("a@w")],
    });
    expect(tile.sub).toBe("1 of 5 shifts has nobody on");
  });

  it("has nothing to measure when no shifts are set up", () => {
    const tile = emptyView().tiles.find((t) => t.label === "Uncovered shifts")!;
    expect(tile.value).toBe("n/a");
    expect(tile.sub).toBe("no shifts are set up");
  });
});

describe("the dateless-roster caveat", () => {
  const blocks = [block("ck", "cashier"), block("sl", LEAD)];
  const assignments = [cell("a@w", "ck", "mon"), cell("lead@w", "sl", "mon")];

  it("warns beside the cover rows when the run holds no returners at all", () => {
    const view = buildScheduleHealthView(
      statsFor({
        blocks,
        assignments,
        students: [student("a@w"), student("lead@w", { positionId: LEAD })],
      }),
      NAMES,
    );
    expect(view.fragilityNote).toEqual({
      text: "Nobody in this run counts as a returner, so every share below reads as 100%. Re-import the roster from the PCPL workbook if start dates are missing.",
      tone: "warning",
    });
    // The caveat is earning its place: every row really does read as fragile.
    // The share it speaks of is the detail column's now, not the bold figure.
    expect(view.fragility.every((r) => r.detail.startsWith("100% of"))).toBe(true);
  });

  it("says nothing once even one returner is placed", () => {
    const view = buildScheduleHealthView(
      statsFor({
        blocks,
        assignments,
        students: [student("a@w", { returner: true }), student("lead@w", { positionId: LEAD })],
      }),
      NAMES,
    );
    expect(view.fragilityNote).toBeNull();
  });

  it("says nothing about a run that placed nobody", () => {
    expect(emptyView().fragilityNote).toBeNull();
  });
});

describe("reading a stored snapshot back", () => {
  const stats = statsFor({ blocks: [], assignments: [], students: [] });

  it("accepts a snapshot this build stamped", () => {
    expect(isReadableRunStats(stats)).toBe(true);
  });

  it("turns down a version-skewed snapshot instead of handing it to the builder", () => {
    // The rollback the version field exists for: a run stamped by a newer build
    // must cost this section, not the whole of /admin/schedule.
    expect(isReadableRunStats({ ...stats, version: RUN_STATS_VERSION + 1 })).toBe(false);
  });

  it("turns down a snapshot from an older stats version too", () => {
    // The direction this build actually moved in: version 2 is what runs stored
    // before `shifts` went down into the per-position rows, and its fragility
    // groups were keyed off the seats. Reading one hopefully would put figures
    // on screen that no longer mean what the labels say.
    expect(isReadableRunStats({ ...stats, version: 2 })).toBe(false);
  });

  it("turns down a run stored before statistics existed", () => {
    expect(isReadableRunStats(undefined)).toBe(false);
  });
});

describe("the per-position table", () => {
  const view = buildScheduleHealthView(
    statsFor({
      blocks: [block("ck", "cashier", 480, 720, 2), block("ck-late", "cashier", 720, 1200)],
      assignments: [cell("a@w", "ck", "mon"), cell("b@w", "ck", "mon"), cell("a@w", "ck", "tue")],
      students: [student("a@w"), student("b@w"), student("idle@w")],
    }),
    NAMES,
  );

  it("formats one row per position, staff, fill, hours, span and load", () => {
    expect(view.positions).toEqual([
      {
        positionId: "cashier",
        name: "Cashier",
        // "in this run": the denominator is the run's input population, which
        // moves with the scope and the non-responders option, not the roster.
        staff: "2 of 3 in this run",
        // 5 Monday-to-Friday cells asking for 2 each; Monday fills both and
        // Tuesday one, so 3 of 10 seats.
        fill: "30%",
        // Per-position shift instances, new in RunStats 3: two weekday blocks
        // are 10 instances, and only ck's Monday and Tuesday are worked.
        emptyShifts: "8 of 10",
        hours: "4h to 8h, median 6h",
        perDay: "4h to 4h",
        span: "8a to 8p",
        // 3 weekday rows sit in both fortnight halves: 6 seats over 14 days.
        load: "0.43 shifts, 0.43 people a day",
      },
    ]);
  });

  it("says a position sets no targets rather than showing 0%", () => {
    const noTargets = buildScheduleHealthView(
      statsFor({
        blocks: [block("ba", "barista")],
        assignments: [cell("z@w", "ba", "mon")],
        students: [student("z@w", { positionId: "barista" })],
      }),
      NAMES,
    );
    expect(noTargets.positions[0]!.fill).toBe("no targets");
  });

  it("says none rather than a zero when every shift on a floor is worked", () => {
    const full = buildScheduleHealthView(
      statsFor({
        blocks: [block("ba", "barista")],
        assignments: WEEKDAYS.map((d) => cell("z@w", "ba", d)),
        students: [student("z@w", { positionId: "barista" })],
      }),
      NAMES,
    );
    expect(full.positions[0]!.emptyShifts).toBe("none");
  });

  it("counts every shift on a floor nobody is on at all", () => {
    // The row the column exists for: no seats means no operating minutes, so
    // the cover table has nothing to say about this floor and this does.
    const idle = buildScheduleHealthView(
      statsFor({
        blocks: [block("ba", "barista"), block("ck", "cashier")],
        assignments: [cell("z@w", "ck", "mon")],
        students: [student("z@w")],
      }),
      NAMES,
    );
    const byName = Object.fromEntries(idle.positions.map((p) => [p.name, p]));
    expect(byName["Barista"]!.emptyShifts).toBe("5 of 5");
    expect(byName["Cashier"]!.emptyShifts).toBe("4 of 5");
  });

  it("falls back to the position id when no name is known", () => {
    const unnamed = buildScheduleHealthView(
      statsFor({
        blocks: [block("x", "mystery")],
        assignments: [cell("z@w", "x", "mon")],
        students: [student("z@w", { positionId: "mystery" })],
      }),
      new Map<string, string>(),
    );
    expect(unnamed.positions[0]!.name).toBe("mystery");
  });
});

describe("the copy rules on a populated view", () => {
  const blocks = [
    block("ck", "cashier", 480, 720, 2),
    block("ca", "culinary-assistant", 480, 720, 1),
    block("ba", "barista", 600, 960),
    block("sl", LEAD, 480, 720),
    block("sl-late", LEAD, 490, 720),
  ];
  const assignments = [
    ...WEEKDAYS.map((d) => cell("a@w", "ck", d)),
    ...WEEKDAYS.map((d) => cell("b@w", "ck", d)),
    cell("c@w", "ca", "mon"),
    cell("d@w", "ba", "tue"),
    cell("newlead@w", "sl", "mon"),
    cell("oldlead@w", "sl-late", "mon"),
  ];
  /** The same run twice: once with no returner anywhere, once with a veteran lead. */
  const viewFor = (veteranLead: boolean) =>
    buildScheduleHealthView(
      statsFor({
        blocks,
        assignments,
        students: [
          student("a@w"),
          student("b@w"),
          student("c@w", { positionId: "culinary-assistant" }),
          student("d@w", { positionId: "barista" }),
          student("newlead@w", { positionId: LEAD }),
          student("oldlead@w", { positionId: LEAD, returner: veteranLead }),
        ],
        poolPositionIds: ["culinary-assistant", "cashier"],
        maxConsecutiveDays: 3,
      }),
      NAMES,
    );

  it("fills every section, so the walk below has something to read", () => {
    const view = viewFor(false);
    // Seven since the uncovered-shifts tile joined the row.
    expect(view.tiles).toHaveLength(7);
    expect(view.hours).toHaveLength(5);
    expect(view.consecutiveDays.length).toBeGreaterThan(0);
    expect(view.daysWorked.length).toBeGreaterThan(0);
    expect(view.cohortLines.length).toBeGreaterThan(0);
    expect(view.perDay.rows).toHaveLength(2);
    expect(view.positions.length).toBeGreaterThan(0);
    expect(view.fragility.length).toBeGreaterThan(0);
    expect(view.notes.length).toBeGreaterThan(0);
    expect(view.fragilityNote).not.toBeNull();
  });

  it("never writes an em dash anywhere in it", () => {
    const strings = [...renderedStrings(viewFor(false)), ...renderedStrings(viewFor(true))];
    expect(strings.length).toBeGreaterThan(80);
    for (const line of strings) expect(line).not.toMatch(/—/);
  });
});

describe("lockstep", () => {
  it("warns when people hold an identical set of shifts", () => {
    const view = buildScheduleHealthView(
      statsFor({
        blocks: [block("wd", "cashier")],
        assignments: [cell("a@w", "wd", "mon"), cell("b@w", "wd", "mon")],
        students: [student("a@w"), student("b@w")],
      }),
      NAMES,
    );
    expect(view.notes).toContainEqual({
      text: "2 people have exactly the same shifts as someone else.",
      tone: "warning",
    });
  });
});
