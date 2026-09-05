import { describe, expect, it } from "vitest";
import {
  buildNameIndex,
  buildPlanRunAssignments,
  buildRepairSeeds,
  type PlanRunStudent,
  type RepairStudent,
} from "./repair-seeds";
import { matchPlan } from "./match";
import { parseW2wPlan } from "./parse";
import { PLAN_BLOCKS, PLAN_MAP, PLAN_SOURCE } from "./plan-fixture";
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

describe("buildPlanRunAssignments", () => {
  const roster = (pairs: [string, Partial<PlanRunStudent>][] = []) =>
    new Map<string, PlanRunStudent>(
      pairs.map(([email, over]) => [email, { everyWeekendOptIn: false, ...over }]),
    );

  it("transcribes a placement even when the student never picked it", () => {
    // The template is what the scheduler decided, not a proposal: repair mode
    // would break this student, transcription keeps them.
    const res = buildPlanRunAssignments(
      [planRow({ day: "tue", employeeName: "Ada" })],
      names([["Ada", "ada@x.edu"]]),
      roster([["ada@x.edu", {}]]),
      "a",
    );
    expect(res.assignments).toEqual([
      {
        studentEmail: "ada@x.edu",
        blockId: "blk",
        day: "tue",
        cohort: "weekday",
        source: "manual",
      },
    ]);
    expect(res.studentsWithNoAssignments).toEqual([]);
  });

  it("separates names nobody answers to from names two students share", () => {
    const res = buildPlanRunAssignments(
      [
        planRow({ day: "mon", employeeName: "Nobody Here" }),
        planRow({ day: "mon", employeeName: "John Smith" }),
      ],
      names([["John Smith", null]]),
      roster([["ada@x.edu", {}]]),
      "a",
    );
    expect(res.unassociatedNames).toEqual([
      { name: "Nobody Here", reason: "unknown" },
      { name: "John Smith", reason: "ambiguous" },
    ]);
    expect(res.assignments).toEqual([]);
  });

  it("skips a name belonging to someone off the roster and reports them", () => {
    const res = buildPlanRunAssignments(
      [planRow({ day: "mon", employeeName: "Gone Person" })],
      names([["Gone Person", "gone@x.edu"]]),
      roster([["ada@x.edu", {}]]),
      "a",
    );
    expect(res.assignments).toEqual([]);
    expect(res.skippedOffRoster).toEqual([{ name: "Gone Person", email: "gone@x.edu" }]);
    // Off-roster people are not counted as students the plan forgot.
    expect(res.studentsWithNoAssignments).toEqual(["ada@x.edu"]);
  });

  it("lists every roster student the plan gives nothing", () => {
    const res = buildPlanRunAssignments(
      [planRow({ day: "mon", employeeName: "Ada" })],
      names([["Ada", "ada@x.edu"]]),
      roster([
        ["ada@x.edu", {}],
        ["zoe@x.edu", {}],
        ["bob@x.edu", {}],
      ]),
      "a",
    );
    expect(res.studentsWithNoAssignments).toEqual(["bob@x.edu", "zoe@x.edu"]);
  });

  it("takes weekend rotation from the uploaded week, with opt-ins on every", () => {
    const satRow = (name: string) =>
      planRow({ day: "sat", employeeName: name, matchedBlockId: "we-blk" });
    const rows = [satRow("Opt In"), satRow("Plain")];
    const nameMap = names([
      ["Opt In", "opt@x.edu"],
      ["Plain", "plain@x.edu"],
    ]);
    const students = roster([
      ["opt@x.edu", { everyWeekendOptIn: true }],
      ["plain@x.edu", {}],
    ]);
    const cohortOf = (week: "a" | "b", email: string) =>
      buildPlanRunAssignments(rows, nameMap, students, week).assignments.find(
        (a) => a.studentEmail === email,
      )?.cohort;
    expect(cohortOf("a", "opt@x.edu")).toBe("every");
    expect(cohortOf("b", "opt@x.edu")).toBe("every");
    expect(cohortOf("a", "plain@x.edu")).toBe("a");
    expect(cohortOf("b", "plain@x.edu")).toBe("b");
  });

  it("makes one assignment out of two seats of the same cell", () => {
    const res = buildPlanRunAssignments(
      [planRow({ day: "mon", employeeName: "Ada" }), planRow({ day: "mon", employeeName: "Ada" })],
      names([["Ada", "ada@x.edu"]]),
      roster([["ada@x.edu", {}]]),
      "a",
    );
    expect(res.assignments).toHaveLength(1);
  });

  it("never invents an assignment for a shift with no Muster block", () => {
    const res = buildPlanRunAssignments(
      [
        planRow({ day: "mon", employeeName: "Ada", matchedBlockId: null }),
        planRow({ day: "tue", employeeName: "Ada" }),
      ],
      names([["Ada", "ada@x.edu"]]),
      roster([["ada@x.edu", {}]]),
      "a",
    );
    expect(res.assignments).toEqual([
      {
        studentEmail: "ada@x.edu",
        blockId: "blk",
        day: "tue",
        cohort: "weekday",
        source: "manual",
      },
    ]);
  });

  it("holds the line on a real week: unmatched shifts and a stale name", () => {
    const parsed = parseW2wPlan(PLAN_SOURCE);
    if (!parsed.ok) throw new Error("fixture must parse");
    const report = matchPlan(parsed.rows, PLAN_MAP, PLAN_BLOCKS);
    const res = buildPlanRunAssignments(
      report.rows,
      names([["Gone, Person", "gone@x.edu"]]),
      roster([["ada@x.edu", {}]]),
      "a",
    );
    // The unmapped Mystery row and the SL meeting row match no block, and the
    // only name on the week belongs to somebody who has left.
    expect(res.assignments).toEqual([]);
    expect(res.skippedOffRoster).toEqual([{ name: "Gone, Person", email: "gone@x.edu" }]);
    expect(res.unassociatedNames).toEqual([]);
  });
});
