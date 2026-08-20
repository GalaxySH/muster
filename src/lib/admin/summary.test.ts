import { describe, expect, it } from "vitest";
import type { ShiftBlock } from "@/lib/domain/types";
import { demandCellKey } from "@/lib/domain/demand";
import { buildAdminGrid } from "./summary";

// The hour cap left this module for domain/caps.ts, its single source, so the
// cap test that lived here now lives in caps.test.ts.

// Minimal block fixtures: one weekday block, two weekend blocks.
const weekdayOpen: ShiftBlock = {
  id: "wd-open",
  positionId: "p",
  dayType: "weekday",
  start: 6 * 60 + 45, // 6:45a (earliest start → derived open)
  end: 10 * 60,
};
const weekdayClose: ShiftBlock = {
  id: "wd-close",
  positionId: "p",
  dayType: "weekday",
  start: 20 * 60, // 8p
  end: 23 * 60 + 30, // 11:30p (latest end → derived close)
};
const weekendA: ShiftBlock = {
  id: "we-a",
  positionId: "p",
  dayType: "weekend",
  start: 8 * 60 + 45,
  end: 12 * 60 + 30,
};
const weekendB: ShiftBlock = {
  id: "we-b",
  positionId: "p",
  dayType: "weekend",
  start: 17 * 60, // 5p
  end: 20 * 60 + 30, // 8:30p
};

const allBlocks = [weekdayOpen, weekdayClose, weekendA, weekendB];

describe("buildAdminGrid", () => {
  it("marks a manually selected cell and leaves the rest off", () => {
    const grid = buildAdminGrid(allBlocks, [{ blockId: "wd-open", day: "mon" }], []);
    const row = grid.weekday.rows.find((r) => r.block.id === "wd-open")!;
    // weekday days are [mon, tue, wed, thu, fri]
    expect(grid.weekday.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(row.cells.map((c) => c.selected)).toEqual([true, false, false, false, false]);
    expect(row.cells.every((c) => !c.autoAssigned && !c.assigned)).toBe(true);
    expect(row.cells[0]!.assignmentSource).toBeNull();
  });

  it("marks an auto-assigned weekend cell", () => {
    const grid = buildAdminGrid(allBlocks, [], [{ blockId: "we-b", day: "sat" }]);
    const row = grid.weekend!.rows.find((r) => r.block.id === "we-b")!;
    // Sunday opens the week, so Sat is the second cell.
    expect(grid.weekend!.days).toEqual(["sun", "sat"]);
    expect(row.cells.map((c) => c.autoAssigned)).toEqual([false, true]);
    expect(row.cells[1]!.selected).toBe(false);
  });

  it("overlays the current run's assignments with their source", () => {
    const grid = buildAdminGrid(allBlocks, [{ blockId: "wd-open", day: "mon" }], [], new Set(), [
      { blockId: "wd-open", day: "mon", source: "engine" },
      { blockId: "wd-close", day: "tue", source: "manual" },
    ]);
    const open = grid.weekday.rows.find((r) => r.block.id === "wd-open")!;
    const close = grid.weekday.rows.find((r) => r.block.id === "wd-close")!;
    // Selected and assigned are independent layers on the same cell.
    expect(open.cells[0]).toEqual({
      selected: true,
      autoAssigned: false,
      assigned: true,
      assignmentSource: "engine",
    });
    // A manual assignment on a cell the student never picked stays visible.
    expect(close.cells[1]).toEqual({
      selected: false,
      autoAssigned: false,
      assigned: true,
      assignmentSource: "manual",
    });
    expect(close.cells[0]!.assigned).toBe(false);
  });

  it("carries through derived open/close and the per-day high-demand overlay", () => {
    // Flag only wd-close on Monday; the bar must land on that cell alone, not the row.
    const grid = buildAdminGrid(allBlocks, [], [], new Set([demandCellKey("wd-close", "mon")]));
    const open = grid.weekday.rows.find((r) => r.block.id === "wd-open")!;
    const close = grid.weekday.rows.find((r) => r.block.id === "wd-close")!;
    expect(open.isOpen).toBe(true);
    expect(open.highDemandDays.every((v) => v === false)).toBe(true);
    expect(close.isClose).toBe(true);
    expect(close.highDemandDays[0]).toBe(true); // Mon
    expect(close.highDemandDays[1]).toBe(false); // Tue
  });

  it("has a weekend sub-grid of null for a weekday-only position", () => {
    const grid = buildAdminGrid([weekdayOpen, weekdayClose], [], []);
    expect(grid.weekend).toBeNull();
  });

  it("keeps one cell per day, aligned to the day order", () => {
    const grid = buildAdminGrid(allBlocks, [{ blockId: "wd-open", day: "fri" }], []);
    const row = grid.weekday.rows.find((r) => r.block.id === "wd-open")!;
    expect(row.cells).toHaveLength(grid.weekday.days.length);
    expect(row.cells[grid.weekday.days.indexOf("fri")]!.selected).toBe(true);
  });
});
