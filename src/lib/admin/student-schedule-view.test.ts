import { describe, it, expect } from "vitest";
import { parseTime } from "@/lib/domain/time";
import type { DayType } from "@/lib/domain/types";
import {
  buildStudentScheduleGrid,
  type StudentScheduleBlock,
  type StudentScheduleCell,
} from "./student-schedule-view";

function block(
  id: string,
  dayType: DayType,
  start: string,
  end: string,
  retired = false,
): StudentScheduleBlock {
  return { id, dayType, start: parseTime(start), end: parseTime(end), retired };
}

const cell = (over: Partial<StudentScheduleCell> = {}): StudentScheduleCell => ({
  blockId: "wd-am",
  day: "mon",
  cohort: "weekday",
  source: "engine",
  ...over,
});

const BLOCKS = [
  block("wd-pm", "weekday", "12p", "4p"),
  block("wd-am", "weekday", "8a", "12p"),
  block("we", "weekend", "9a", "1p"),
];

describe("buildStudentScheduleGrid", () => {
  it("lays rows out by start time with the availability grid's labels", () => {
    const grid = buildStudentScheduleGrid(BLOCKS, []);
    expect(grid.weekday.rows.map((r) => r.label)).toEqual(["8a–12p", "12p–4p"]);
    expect(grid.weekend!.rows.map((r) => r.label)).toEqual(["9a–1p"]);
    expect(grid.assignedCount).toBe(0);
  });

  it("fills the assigned cells with their source and leaves the rest empty", () => {
    const grid = buildStudentScheduleGrid(BLOCKS, [
      cell(),
      cell({ blockId: "wd-pm", day: "tue", source: "manual" }),
    ]);
    const am = grid.weekday.rows[0]!;
    expect(am.cells.find((c) => c.day === "mon")!.source).toBe("engine");
    expect(am.cells.find((c) => c.day === "tue")!.source).toBeNull();
    const pm = grid.weekday.rows[1]!;
    expect(pm.cells.find((c) => c.day === "tue")!.source).toBe("manual");
    expect(grid.assignedCount).toBe(2);
  });

  it("letters filled weekend cells with their rotation and weekday cells never", () => {
    const grid = buildStudentScheduleGrid(BLOCKS, [
      cell(),
      cell({ blockId: "we", day: "sat", cohort: "b" }),
      cell({ blockId: "we", day: "sun", cohort: "every" }),
    ]);
    const weekdayMon = grid.weekday.rows[0]!.cells.find((c) => c.day === "mon")!;
    expect(weekdayMon.rotation).toBeNull();
    const weekend = grid.weekend!.rows[0]!;
    expect(weekend.cells.find((c) => c.day === "sat")!.rotation).toBe("B");
    expect(weekend.cells.find((c) => c.day === "sun")!.rotation).toBe("E");
  });

  it("renders weekend columns Sun first, Sat last (PLAN §7 week shape)", () => {
    const grid = buildStudentScheduleGrid(BLOCKS, []);
    expect(grid.weekend!.days).toEqual(["sun", "sat"]);
  });

  it("omits the weekend sub-grid when there are no weekend blocks", () => {
    const grid = buildStudentScheduleGrid([block("wd", "weekday", "8a", "12p")], []);
    expect(grid.weekend).toBeNull();
  });

  it("keeps retired-block rows, flagged, so carried shifts stay visible", () => {
    const grid = buildStudentScheduleGrid(
      [...BLOCKS, block("wd-old", "weekday", "4p", "8p", true)],
      [cell({ blockId: "wd-old", day: "fri" })],
    );
    const old = grid.weekday.rows.find((r) => r.blockId === "wd-old")!;
    expect(old.retired).toBe(true);
    expect(old.cells.find((c) => c.day === "fri")!.source).toBe("engine");
  });

  it("throws on an assignment whose block is missing rather than dropping it", () => {
    expect(() => buildStudentScheduleGrid(BLOCKS, [cell({ blockId: "ghost" })])).toThrow(
      /ghost/,
    );
  });
});
