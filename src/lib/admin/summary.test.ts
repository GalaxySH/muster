import { describe, expect, it } from "vitest";
import type { ShiftBlock } from "@/lib/domain/types";
import { demandCellKey } from "@/lib/domain/demand";
import { MAX_HOURS_DOMESTIC, MAX_HOURS_INTERNATIONAL, buildAdminGrid, hourCap } from "./summary";

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

describe("hourCap", () => {
  it("is 30h domestic, 20h international", () => {
    expect(hourCap(false)).toBe(MAX_HOURS_DOMESTIC);
    expect(hourCap(false)).toBe(30);
    expect(hourCap(true)).toBe(MAX_HOURS_INTERNATIONAL);
    expect(hourCap(true)).toBe(20);
  });
});

describe("buildAdminGrid", () => {
  it("marks a manually selected cell 'on' and leaves the rest 'off'", () => {
    const grid = buildAdminGrid(allBlocks, [{ blockId: "wd-open", day: "mon" }], []);
    const row = grid.weekday.rows.find((r) => r.block.id === "wd-open")!;
    // weekday days are [mon, tue, wed, thu, fri]
    expect(grid.weekday.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(row.cells).toEqual(["on", "off", "off", "off", "off"]);
  });

  it("marks an auto-assigned weekend cell 'auto'", () => {
    const grid = buildAdminGrid(allBlocks, [], [{ blockId: "we-b", day: "sat" }]);
    const row = grid.weekend!.rows.find((r) => r.block.id === "we-b")!;
    // weekend days are [sat, sun]
    expect(grid.weekend!.days).toEqual(["sat", "sun"]);
    expect(row.cells).toEqual(["auto", "off"]);
  });

  it("prefers 'auto' over 'on' when a cell is both (auto-assign overlay wins)", () => {
    const grid = buildAdminGrid(
      allBlocks,
      [{ blockId: "we-b", day: "sat" }],
      [{ blockId: "we-b", day: "sat" }],
    );
    const row = grid.weekend!.rows.find((r) => r.block.id === "we-b")!;
    expect(row.cells[0]).toBe("auto");
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

  it("keeps one cell state per day, aligned to the day order", () => {
    const grid = buildAdminGrid(allBlocks, [{ blockId: "wd-open", day: "fri" }], []);
    const row = grid.weekday.rows.find((r) => r.block.id === "wd-open")!;
    expect(row.cells).toHaveLength(grid.weekday.days.length);
    expect(row.cells[grid.weekday.days.indexOf("fri")]).toBe("on");
  });
});
