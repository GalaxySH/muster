import { describe, it, expect } from "vitest";
import { parseTime } from "../time";
import type { SelectedShift, ShiftBlock } from "../types";
import { improveAssignments } from "./improve";
import type { ScheduleAssignment, ScheduleStudent } from "./types";

function block(
  id: string,
  dayType: "weekday" | "weekend",
  start: string,
  end: string,
  desiredCapacity: number | null = null,
): ShiftBlock {
  return {
    id,
    positionId: "barista",
    dayType,
    start: parseTime(start),
    end: parseTime(end),
    desiredCapacity,
  };
}

const sel = (blockId: string, day: SelectedShift["day"]): SelectedShift => ({ blockId, day });

function student(email: string, over: Partial<ScheduleStudent> = {}): ScheduleStudent {
  return {
    email,
    positionId: "barista",
    international: false,
    everyWeekendOptIn: false,
    desiredHours: 10,
    submittedAt: new Date(Date.UTC(2026, 7, 1)),
    scheduled: false,
    selection: [],
    ...over,
  };
}

const row = (
  studentEmail: string,
  blockId: string,
  day: SelectedShift["day"],
  cohort: ScheduleAssignment["cohort"] = "weekday",
): ScheduleAssignment => ({ studentEmail, blockId, day, cohort });

describe("improveAssignments", () => {
  it("moves a seat from an untargeted cell into a scarcer, later one", () => {
    const blocks = [
      block("morning", "weekday", "8a", "12p"),
      block("night", "weekday", "5p", "9p", 3),
    ];
    const students = [student("s@w", { selection: [sel("morning", "mon"), sel("night", "mon")] })];
    const r = improveAssignments([row("s@w", "morning", "mon")], students, blocks);
    expect(r.moved).toBe(1);
    expect(r.assignments[0]!.blockId).toBe("night");
  });

  it("never lowers the student's covered hours", () => {
    const blocks = [
      block("morning", "weekday", "8a", "12p"),
      block("short", "weekday", "5p", "7p", 3),
    ];
    const students = [student("s@w", { selection: [sel("morning", "mon"), sel("short", "mon")] })];
    const r = improveAssignments([row("s@w", "morning", "mon")], students, blocks);
    expect(r.moved).toBe(0);
    expect(r.assignments[0]!.blockId).toBe("morning");
  });

  it("never touches a student marked scheduled", () => {
    const blocks = [
      block("morning", "weekday", "8a", "12p"),
      block("night", "weekday", "5p", "9p", 3),
    ];
    const students = [
      student("s@w", { scheduled: true, selection: [sel("morning", "mon"), sel("night", "mon")] }),
    ];
    const r = improveAssignments([row("s@w", "morning", "mon")], students, blocks);
    expect(r.moved).toBe(0);
  });

  it("respects the target cell's remaining capacity", () => {
    const blocks = [
      block("morning", "weekday", "8a", "12p"),
      block("night", "weekday", "5p", "9p", 1),
    ];
    const students = [
      student("s@w", { selection: [sel("morning", "mon"), sel("night", "mon")] }),
      student("holder@w", { selection: [sel("night", "mon")] }),
    ];
    const r = improveAssignments(
      [row("s@w", "morning", "mon"), row("holder@w", "night", "mon")],
      students,
      blocks,
    );
    expect(r.moved).toBe(0);
  });

  it("only relocates within the same day", () => {
    const blocks = [
      block("morning", "weekday", "8a", "12p"),
      block("night", "weekday", "5p", "9p", 3),
    ];
    const students = [student("s@w", { selection: [sel("morning", "mon"), sel("night", "tue")] })];
    const r = improveAssignments([row("s@w", "morning", "mon")], students, blocks);
    expect(r.moved).toBe(0);
  });

  it("moves into a cell that staggers over a sibling, forming a double", () => {
    const blocks = [
      block("noon", "weekday", "12p", "2p"),
      block("evening", "weekday", "2p", "4p"),
      block("late", "weekday", "1:45p", "4:30p", 3),
    ];
    const students = [
      student("s@w", {
        selection: [sel("noon", "mon"), sel("evening", "mon"), sel("late", "mon")],
      }),
    ];
    const r = improveAssignments(
      [row("s@w", "noon", "mon"), row("s@w", "evening", "mon")],
      students,
      blocks,
    );
    // The 15-minute handoff overlap with noon is no conflict; the destination
    // extends the merged span, so coverage never drops.
    expect(r.moved).toBe(1);
    expect(r.assignments.map((a) => a.blockId).sort()).toEqual(["late", "noon"]);
  });

  it("refuses a move whose destination would swallow a sibling assignment", () => {
    const blocks = [
      block("inner", "weekday", "12p", "2p"),
      block("tail", "weekday", "2p", "3p"),
      block("big", "weekday", "11:30a", "3:30p", 3),
    ];
    const students = [
      student("s@w", { selection: [sel("inner", "mon"), sel("tail", "mon"), sel("big", "mon")] }),
    ];
    const r = improveAssignments(
      [row("s@w", "inner", "mon"), row("s@w", "tail", "mon")],
      students,
      blocks,
    );
    // big contains each sibling, so neither row may relocate into it, even
    // though the move would raise coverage and fit the cap.
    expect(r.moved).toBe(0);
  });

  it("refuses a move that would push the day past the 8h cap", () => {
    const blocks = [
      block("early", "weekday", "8a", "12p"),
      block("mid", "weekday", "12p", "4p"),
      block("night5", "weekday", "4p", "9p", 5),
    ];
    const students = [
      student("s@w", { selection: [sel("early", "mon"), sel("mid", "mon"), sel("night5", "mon")] }),
    ];
    const r = improveAssignments(
      [row("s@w", "early", "mon"), row("s@w", "mid", "mon")],
      students,
      blocks,
    );
    expect(r.moved).toBe(0);
  });

  it("prefers the biggest tier gain when several targets fit", () => {
    const blocks = [
      block("morning", "weekday", "8a", "12p"),
      block("evening", "weekday", "1p", "5p", 3),
      block("night", "weekday", "5p", "9p", 3),
    ];
    const students = [
      student("s@w", {
        selection: [sel("morning", "mon"), sel("evening", "mon"), sel("night", "mon")],
      }),
    ];
    const r = improveAssignments([row("s@w", "morning", "mon")], students, blocks);
    expect(r.moved).toBe(1);
    expect(r.assignments[0]!.blockId).toBe("night");
  });

  it("keeps the student's weekend cohort on a weekend move", () => {
    const blocks = [
      block("we-day", "weekend", "11a", "3p"),
      block("we-close", "weekend", "3p", "7p", 1),
    ];
    const students = [
      student("s@w", { selection: [sel("we-day", "sat"), sel("we-close", "sat")] }),
      student("other@w", { selection: [sel("we-close", "sat")] }),
    ];
    const r = improveAssignments(
      [row("s@w", "we-day", "sat", "b"), row("other@w", "we-close", "sat", "a")],
      students,
      blocks,
    );
    expect(r.moved).toBe(1);
    const moved = r.assignments.find((a) => a.studentEmail === "s@w")!;
    expect(moved.blockId).toBe("we-close");
    expect(moved.cohort).toBe("b");
  });
});
