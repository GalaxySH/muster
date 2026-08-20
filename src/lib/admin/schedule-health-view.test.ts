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
    expect(view.positions).toEqual([]);
    expect(view.notes).toEqual([]);
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
      expect(row.share).toBe("n/a");
      expect(row.sharePercent).toBeNull();
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
      share: "100%",
      sharePercent: 100,
      // Detail is a share now, not "4h of 4h staffed": these are picture-minutes,
      // one per distinct staffing day, so they are not calendar hours.
      detail: "100% of staffed time",
      tone: "danger",
      pill: "fragile",
    });
    expect(byLabel["Cashier"]).toMatchObject({ share: "0%", tone: null, pill: "covered" });
    expect(byLabel["All positions"]!.share).toBe("50%");
    // One shared timeline: the returner overlaps the new person everywhere.
    expect(byLabel["Anyone in the building"]).toMatchObject({ share: "0%", pill: "covered" });
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
    expect(view.fragility[0]!.label).toBe("Cashier + Culinary Assistant");
    expect(view.fragility[0]!.tone).toBeNull();
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
    expect(lead.share).toBe("4%");
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
    expect(lead).toMatchObject({ share: "0%", tone: null, pill: "covered" });
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
    expect(view.fragility[0]).toMatchObject({ share: "13%", tone: "warning", pill: "thin" });
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
    // the boundary itself is a warning and nothing worse.
    const row = soloShareOf(528);
    expect(row.share).toBe("20%");
    expect(row.tone).toBe("warning");
    expect(row.pill).toBe("thin");
  });

  it("keeps exactly a tenth clear of the warning", () => {
    // 24 solo minutes of 240: 0.10 on the nose, and the rule is "over a tenth".
    const row = soloShareOf(504);
    expect(row.share).toBe("10%");
    expect(row.tone).toBeNull();
    expect(row.pill).toBe("covered");
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
    expect(view.fragility.every((r) => r.share === "100%")).toBe(true);
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
    expect(view.tiles).toHaveLength(6);
    expect(view.hours).toHaveLength(5);
    expect(view.consecutiveDays.length).toBeGreaterThan(0);
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
