import { describe, it, expect } from "vitest";
import { EPSILON_MINUTES, parseTime } from "../time";
import type { Position, SelectedShift, ShiftBlock } from "../types";
import { generateAssignments } from "./engine";
import {
  isBelowMinHours,
  isOverMaxHours,
  problemGroups,
  type ProblemKind,
  type ProblemLookup,
} from "./problems";
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
  minHours: (email: string) => number | null = () => CA.minHours,
  international: (email: string) => boolean = () => false,
): ProblemLookup {
  return {
    nameOf: (e) => names[e] ?? e,
    minDaysOf: minDays,
    minHoursOf: minHours,
    internationalOf: international,
  };
}

const sizeOf = (groups: ReturnType<typeof problemGroups>, kind: ProblemKind) =>
  groups.find((g) => g.kind === kind)?.students.length ?? 0;

describe("isBelowMinHours", () => {
  it("compares against the floor with the rounding tolerance", () => {
    expect(isBelowMinHours(540, 10)).toBe(true);
    expect(isBelowMinHours(600, 10)).toBe(false);
    expect(isBelowMinHours(660, 10)).toBe(false);
    // A hair under the floor is the floor, not a violation.
    expect(isBelowMinHours(600 - EPSILON_MINUTES / 2, 10)).toBe(false);
  });

  it("never flags a student whose position is unknown", () => {
    expect(isBelowMinHours(0, null)).toBe(false);
  });
});

describe("isOverMaxHours", () => {
  // 30h domestic and 20h international, in minutes.
  const DOMESTIC = 30 * 60;
  const INTERNATIONAL = 20 * 60;

  it("leaves a student sitting exactly on their cap alone", () => {
    expect(isOverMaxHours(DOMESTIC, false)).toBe(false);
    expect(isOverMaxHours(INTERNATIONAL, true)).toBe(false);
  });

  it("compares against the cap with the same rounding tolerance", () => {
    // The mirror of the floor rule: a hair over the cap is the cap.
    expect(isOverMaxHours(DOMESTIC + EPSILON_MINUTES / 2, false)).toBe(false);
    expect(isOverMaxHours(DOMESTIC + 2 * EPSILON_MINUTES, false)).toBe(true);
  });

  it("flags a real overshoot", () => {
    expect(isOverMaxHours(DOMESTIC + 60, false)).toBe(true);
    expect(isOverMaxHours(DOMESTIC - 60, false)).toBe(false);
  });

  it("holds an international student to the lower cap", () => {
    // 25h is over the 20h international cap and well under the 30h one.
    expect(isOverMaxHours(25 * 60, true)).toBe(true);
    expect(isOverMaxHours(25 * 60, false)).toBe(false);
  });
});

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
    expect(r.report.belowMinHours).toBe(2);

    const groups = problemGroups(r.report, lookup());
    expect(sizeOf(groups, "dropped")).toBe(r.report.droppedStudents.length);
    expect(sizeOf(groups, "no-position")).toBe(r.report.skippedNoPosition.length);
    expect(sizeOf(groups, "short-of-hours")).toBe(r.report.shortOfTarget);
    expect(sizeOf(groups, "below-min-hours")).toBe(r.report.belowMinHours);
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

  it("skips the hours-minimum judgment when the position minimum is unknown", () => {
    const rep = report({ students: [row("s@w", { assignedMinutes: 60 })] });
    expect(
      sizeOf(
        problemGroups(
          rep,
          lookup(
            {},
            () => 2,
            () => null,
          ),
        ),
        "below-min-hours",
      ),
    ).toBe(0);
    expect(sizeOf(problemGroups(rep, lookup()), "below-min-hours")).toBe(1);
  });

  it("leaves a student who clears the floor but not their target out of below-min-hours", () => {
    // 12h assigned against a 20h target and the position's 10h floor.
    const rep = report({ students: [row("s@w", { assignedMinutes: 720, targetMinutes: 1200 })] });
    const groups = problemGroups(rep, lookup());
    expect(sizeOf(groups, "short-of-hours")).toBe(1);
    expect(sizeOf(groups, "below-min-hours")).toBe(0);
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
      "below-min-hours",
      "below-min-days",
    ]);
    expect(groups[0]!.students).toEqual([
      { email: "zeta@w", name: "Aaron Zeta" },
      { email: "alpha@w", name: "alpha@w" },
    ]);
    expect(groups[2]!.students.map((s) => s.email)).toEqual(["amy@w", "zed@w"]);
    expect(groups[3]!.students.map((s) => s.email)).toEqual(["amy@w", "zed@w"]);
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
      "1 student is below their position's minimum hours",
      "1 could not span their minimum days",
    ]);

    const many = problemGroups(report({ droppedStudents: ["a@w", "b@w"] }), lookup());
    expect(many.map((g) => g.label)).toEqual(["2 left the roster and were dropped"]);
  });

  it("omits every group on a clean report", () => {
    expect(problemGroups(report({ students: [row("ok@w")] }), lookup())).toEqual([]);
  });
});

describe("the over-max-hours group", () => {
  it("takes the student past their cap and leaves the one sitting on it", () => {
    const rep = report({
      students: [
        row("over@w", { assignedMinutes: 31 * 60 }),
        row("at@w", { assignedMinutes: 1800 }),
      ],
    });
    const group = problemGroups(rep, lookup()).find((g) => g.kind === "over-max-hours")!;
    expect(group.students).toEqual([{ email: "over@w", name: "over@w" }]);
    expect(group.label).toBe("1 student is over their weekly hour maximum");
  });

  it("holds an international student to the lower cap", () => {
    const rep = report({ students: [row("intl@w", { assignedMinutes: 25 * 60 })] });
    const intl = lookup(
      {},
      () => 2,
      () => 10,
      () => true,
    );
    expect(sizeOf(problemGroups(rep, intl), "over-max-hours")).toBe(1);
    expect(sizeOf(problemGroups(rep, lookup()), "over-max-hours")).toBe(0);
  });

  it("includes frozen students, unlike every other group here", () => {
    // The deliberate asymmetry: a hand edit on a kept row is the likeliest way
    // somebody lands over the cap, so the one group that would go quiet on that
    // case does not. Compare the frozen student above, who is in no group.
    const rep = report({ students: [row("kept@w", { assignedMinutes: 40 * 60, frozen: true })] });
    const groups = problemGroups(rep, lookup());
    expect(groups.map((g) => g.kind)).toEqual(["over-max-hours"]);
    expect(groups[0]!.students).toEqual([{ email: "kept@w", name: "kept@w" }]);
  });

  it("sits between the two minimum groups in the fixed order", () => {
    const rep = report({
      students: [
        row("zed@w", { assignedMinutes: 0, daysUsed: 0 }),
        row("over@w", { assignedMinutes: 31 * 60 }),
      ],
      droppedStudents: ["gone@w"],
      skippedNoPosition: ["skip@w"],
    });
    expect(problemGroups(rep, lookup()).map((g) => g.kind)).toEqual([
      "dropped",
      "no-position",
      "short-of-hours",
      "below-min-hours",
      "over-max-hours",
      "below-min-days",
    ]);
  });
});
