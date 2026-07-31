import { describe, it, expect } from "vitest";
import { parseTime } from "../time";
import type { Position, SelectedShift, ShiftBlock } from "../types";
import { generateAssignments } from "./engine";
import { problemGroups, type ProblemKind, type ProblemLookup } from "./problems";
import type {
  EngineReport,
  ScheduleAssignment,
  ScheduleStudent,
  StudentScheduleReport,
} from "./types";

const CA: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};

function block(id: string, start: string, end: string): ShiftBlock {
  return {
    id,
    positionId: "ca",
    dayType: "weekday",
    start: parseTime(start),
    end: parseTime(end),
    desiredCapacity: null,
  };
}

const sel = (blockId: string, day: SelectedShift["day"]): SelectedShift => ({ blockId, day });

function student(email: string, over: Partial<ScheduleStudent> = {}): ScheduleStudent {
  return {
    email,
    positionId: "ca",
    international: false,
    everyWeekendOptIn: false,
    desiredHours: 10,
    submittedAt: new Date(Date.UTC(2026, 7, 1)),
    scheduled: false,
    selection: [],
    ...over,
  };
}

function report(over: Partial<EngineReport> = {}): EngineReport {
  return {
    students: [],
    droppedStudents: [],
    droppedBlockGone: 0,
    skippedNoPosition: [],
    shortOfTarget: 0,
    belowMinDays: 0,
    ...over,
  };
}

function row(email: string, over: Partial<StudentScheduleReport> = {}): StudentScheduleReport {
  return {
    email,
    targetMinutes: 600,
    assignedMinutes: 600,
    daysUsed: 2,
    cohort: null,
    frozen: false,
    ...over,
  };
}

function lookup(
  names: Record<string, string> = {},
  minDays: (email: string) => number | null = () => 2,
): ProblemLookup {
  return { nameOf: (e) => names[e] ?? e, minDaysOf: minDays };
}

const sizeOf = (groups: ReturnType<typeof problemGroups>, kind: ProblemKind) =>
  groups.find((g) => g.kind === kind)?.students.length ?? 0;

describe("problemGroups", () => {
  it("matches the engine's aggregate counts on a real run", () => {
    const blocks = [block("am", "8a", "12p"), block("pm", "12p", "4p")];
    const previous: ScheduleAssignment[] = [
      { studentEmail: "gone@w", blockId: "am", day: "mon", cohort: "weekday" },
    ];
    const r = generateAssignments({
      students: [
        // Short of a 20h target: only two 4h cells offered.
        student("short@w", { desiredHours: 20, selection: [sel("am", "mon"), sel("am", "tue")] }),
        // One day offered: below the 2-day minimum, and short of hours too.
        student("oneday@w", { selection: [sel("am", "wed")] }),
        // Fine: two full 8h days cover the 10h target.
        student("fine@w", {
          selection: [sel("am", "thu"), sel("pm", "thu"), sel("am", "fri"), sel("pm", "fri")],
        }),
        student("nopos@w", { positionId: null }),
      ],
      positions: [CA],
      blocks,
      previous,
    });

    expect(r.report.droppedStudents).toEqual(["gone@w"]);
    expect(r.report.skippedNoPosition).toEqual(["nopos@w"]);
    expect(r.report.shortOfTarget).toBe(2);
    expect(r.report.belowMinDays).toBe(1);

    const groups = problemGroups(r.report, lookup());
    expect(sizeOf(groups, "dropped")).toBe(r.report.droppedStudents.length);
    expect(sizeOf(groups, "no-position")).toBe(r.report.skippedNoPosition.length);
    expect(sizeOf(groups, "short-of-hours")).toBe(r.report.shortOfTarget);
    expect(sizeOf(groups, "below-min-days")).toBe(r.report.belowMinDays);
    expect(groups.find((g) => g.kind === "below-min-days")?.students).toEqual([
      { email: "oneday@w", name: "oneday@w" },
    ]);
  });

  it("never counts frozen students as short or below their day minimum", () => {
    const rep = report({
      students: [row("frozen@w", { assignedMinutes: 120, daysUsed: 1, frozen: true }), row("ok@w")],
    });
    expect(problemGroups(rep, lookup())).toEqual([]);
  });

  it("skips the day-minimum judgment when the position minimum is unknown", () => {
    const rep = report({ students: [row("s@w", { daysUsed: 1 })] });
    expect(
      problemGroups(
        rep,
        lookup({}, () => null),
      ),
    ).toEqual([]);
    expect(sizeOf(problemGroups(rep, lookup()), "below-min-days")).toBe(1);
  });

  it("orders groups fixedly and students by name then email", () => {
    const rep = report({
      students: [
        row("zed@w", { assignedMinutes: 0, daysUsed: 0 }),
        row("amy@w", { assignedMinutes: 0, daysUsed: 0 }),
      ],
      droppedStudents: ["zeta@w", "alpha@w"],
      skippedNoPosition: ["skip@w"],
    });
    const groups = problemGroups(rep, lookup({ "zeta@w": "Aaron Zeta", "zed@w": "Ann Zed" }));
    expect(groups.map((g) => g.kind)).toEqual([
      "dropped",
      "no-position",
      "short-of-hours",
      "below-min-days",
    ]);
    expect(groups[0]!.students).toEqual([
      { email: "zeta@w", name: "Aaron Zeta" },
      { email: "alpha@w", name: "alpha@w" },
    ]);
    expect(groups[2]!.students.map((s) => s.email)).toEqual(["amy@w", "zed@w"]);
  });

  it("writes count-aware labels", () => {
    const one = problemGroups(
      report({
        students: [row("s@w", { assignedMinutes: 0, daysUsed: 1 })],
        droppedStudents: ["gone@w"],
        skippedNoPosition: ["skip@w"],
      }),
      lookup(),
    );
    expect(one.map((g) => g.label)).toEqual([
      "1 left the roster and was dropped",
      "1 skipped with no position set",
      "1 student is short of their hours",
      "1 could not span their minimum days",
    ]);

    const many = problemGroups(report({ droppedStudents: ["a@w", "b@w"] }), lookup());
    expect(many.map((g) => g.label)).toEqual(["2 left the roster and were dropped"]);
  });

  it("omits every group on a clean report", () => {
    expect(problemGroups(report({ students: [row("ok@w")] }), lookup())).toEqual([]);
  });
});
