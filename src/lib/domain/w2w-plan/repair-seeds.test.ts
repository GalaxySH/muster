import { describe, expect, it } from "vitest";
import { buildNameIndex, buildRepairSeeds, type RepairStudent } from "./repair-seeds";
import type { MatchedPlanRow } from "./types";
import type { Day } from "../types";

const DAY_CAP = 8 * 60;

function planRow(
  over: Partial<MatchedPlanRow> & { day: Day; employeeName: string },
): MatchedPlanRow {
  return {
    seq: 0,
    w2wPositionId: "100",
    w2wPositionName: "GDEC - CA",
    category: "",
    description: "",
    startTime: "08:00 AM",
    endTime: "11:00 AM",
    duration: "3.0",
    startMinutes: 480,
    endMinutes: 660,
    employeeNumber: "",
    musterPositionId: "ca",
    matchedBlockId: "blk",
    ...over,
  };
}

const student = (over: Partial<RepairStudent> = {}): RepairStudent => ({
  everyWeekendOptIn: false,
  selection: [{ blockId: "blk", day: "mon" }],
  ...over,
});

const names = (pairs: [string, string | null][]) => new Map(pairs);

describe("buildNameIndex", () => {
  it("lets mapping names win over derived names", () => {
    const index = buildNameIndex(
      [{ name: "Ada Lovelace", email: "real@x.edu" }],
      [{ name: "Ada Lovelace", email: "derived@x.edu" }],
    );
    expect(index.get("Ada Lovelace")).toBe("real@x.edu");
  });

  it("nulls a name duplicated in the mapping instead of picking one", () => {
    const index = buildNameIndex(
      [
        { name: "John Smith", email: "js1@x.edu" },
        { name: "John Smith", email: "js2@x.edu" },
      ],
      [],
    );
    expect(index.get("John Smith")).toBeNull();
  });

  it("nulls an ambiguous derived name", () => {
    const index = buildNameIndex(
      [],
      [
        { name: "John Smith", email: "js1@x.edu" },
        { name: "John Smith", email: "js2@x.edu" },
      ],
    );
    expect(index.get("John Smith")).toBeNull();
  });
});

describe("buildRepairSeeds", () => {
  it("seeds a valid placement", () => {
    const res = buildRepairSeeds(
      [planRow({ day: "mon", employeeName: "Ada" })],
      names([["Ada", "ada@x.edu"]]),
      new Map([["ada@x.edu", student()]]),
      "a",
      DAY_CAP,
    );
    expect(res.byEmail.get("ada@x.edu")).toEqual([
      { studentEmail: "ada@x.edu", blockId: "blk", day: "mon", cohort: "weekday" },
    ]);
    expect(res.brokenStudents).toEqual([]);
  });

  it("drops the whole student when one placement is broken", () => {
    const rows = [
      planRow({ day: "mon", employeeName: "Ada" }),
      planRow({ day: "tue", employeeName: "Ada", matchedBlockId: null }),
    ];
    const res = buildRepairSeeds(
      rows,
      names([["Ada", "ada@x.edu"]]),
      new Map([["ada@x.edu", student()]]),
      "a",
      DAY_CAP,
    );
    expect(res.byEmail.size).toBe(0);
    expect(res.brokenStudents).toEqual(["ada@x.edu"]);
  });

  it("breaks on a cell outside the student's selection", () => {
    const res = buildRepairSeeds(
      [planRow({ day: "tue", employeeName: "Ada" })],
      names([["Ada", "ada@x.edu"]]),
      new Map([["ada@x.edu", student()]]),
      "a",
      DAY_CAP,
    );
    expect(res.brokenStudents).toEqual(["ada@x.edu"]);
  });

  it("takes weekend rotation from the plan week, with opt-ins on every", () => {
    const satRow = (name: string) =>
      planRow({
        day: "sat",
        employeeName: name,
        matchedBlockId: "we-blk",
      });
    const sel = { selection: [{ blockId: "we-blk", day: "sat" as Day }] };
    const eligible = new Map([
      ["opt@x.edu", student({ everyWeekendOptIn: true, ...sel })],
      ["plain@x.edu", student(sel)],
    ]);
    const rows = [satRow("Opt In"), satRow("Plain")];
    const nameMap = names([
      ["Opt In", "opt@x.edu"],
      ["Plain", "plain@x.edu"],
    ]);
    const weekA = buildRepairSeeds(rows, nameMap, eligible, "a", DAY_CAP);
    const weekB = buildRepairSeeds(rows, nameMap, eligible, "b", DAY_CAP);
    expect(weekA.byEmail.get("opt@x.edu")![0]!.cohort).toBe("every");
    expect(weekA.byEmail.get("plain@x.edu")![0]!.cohort).toBe("a");
    expect(weekB.byEmail.get("plain@x.edu")![0]!.cohort).toBe("b");
    expect(weekA.brokenStudents).toEqual([]);
  });

  it("dedupes two seats of one cell carrying the same name", () => {
    const res = buildRepairSeeds(
      [planRow({ day: "mon", employeeName: "Ada" }), planRow({ day: "mon", employeeName: "Ada" })],
      names([["Ada", "ada@x.edu"]]),
      new Map([["ada@x.edu", student()]]),
      "a",
      DAY_CAP,
    );
    expect(res.byEmail.get("ada@x.edu")).toHaveLength(1);
    expect(res.skippedCells).toBe(0);
  });

  it("breaks a student whose same-day seeds add no unique coverage", () => {
    const rows = [
      planRow({ day: "mon", employeeName: "Ada" }),
      planRow({
        day: "mon",
        employeeName: "Ada",
        matchedBlockId: "inner",
        startMinutes: 500,
        endMinutes: 600,
      }),
    ];
    const res = buildRepairSeeds(
      rows,
      names([["Ada", "ada@x.edu"]]),
      new Map([
        [
          "ada@x.edu",
          student({
            selection: [
              { blockId: "blk", day: "mon" },
              { blockId: "inner", day: "mon" },
            ],
          }),
        ],
      ]),
      "a",
      DAY_CAP,
    );
    expect(res.brokenStudents).toEqual(["ada@x.edu"]);
  });

  it("breaks a student whose day exceeds the hour cap", () => {
    const rows = [
      planRow({ day: "mon", employeeName: "Ada", startMinutes: 480, endMinutes: 780 }),
      planRow({
        day: "mon",
        employeeName: "Ada",
        matchedBlockId: "late",
        startMinutes: 800,
        endMinutes: 1100,
      }),
    ];
    const res = buildRepairSeeds(
      rows,
      names([["Ada", "ada@x.edu"]]),
      new Map([
        [
          "ada@x.edu",
          student({
            selection: [
              { blockId: "blk", day: "mon" },
              { blockId: "late", day: "mon" },
            ],
          }),
        ],
      ]),
      "a",
      9 * 60,
    );
    expect(res.brokenStudents).toEqual(["ada@x.edu"]);
  });

  it("counts unresolvable names and unseedable students separately", () => {
    const res = buildRepairSeeds(
      [
        planRow({ day: "mon", employeeName: "Unknown Person" }),
        planRow({ day: "mon", employeeName: "Off Roster" }),
      ],
      names([["Off Roster", "gone@x.edu"]]),
      new Map(),
      "a",
      DAY_CAP,
    );
    expect(res.skippedNames).toEqual(["Unknown Person"]);
    expect(res.skippedCells).toBe(1);
    expect(res.brokenStudents).toEqual([]);
  });
});
