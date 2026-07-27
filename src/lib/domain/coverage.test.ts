import { describe, it, expect } from "vitest";
import {
  assignedCellCount,
  buildCoverageRows,
  coverageStatus,
  latenessTier,
  summarizeAssignedCoverage,
  summarizeCoverage,
} from "./coverage";
import type { CellCount } from "./demand";
import { parseTime } from "./time";
import type { DayType, ShiftBlock } from "./types";

function block(
  id: string,
  dayType: DayType,
  start: string,
  end: string,
  desiredCapacity: number | null = null,
): ShiftBlock {
  return { id, positionId: "ca", dayType, start: parseTime(start), end: parseTime(end), desiredCapacity };
}

describe("latenessTier", () => {
  it("tiers by end time: night at 8p, evening at 5p, day before that", () => {
    expect(latenessTier(parseTime("11:30p"))).toBe("night");
    expect(latenessTier(parseTime("8p"))).toBe("night");
    expect(latenessTier(parseTime("7:59p"))).toBe("evening");
    expect(latenessTier(parseTime("5p"))).toBe("evening");
    expect(latenessTier(parseTime("4:59p"))).toBe("day");
    expect(latenessTier(parseTime("10a"))).toBe("day");
  });
});

describe("coverageStatus", () => {
  it("is none without a target, regardless of count", () => {
    expect(coverageStatus(0, null)).toBe("none");
    expect(coverageStatus(12, null)).toBe("none");
  });

  it("is ok at or above the target", () => {
    expect(coverageStatus(6, 6)).toBe("ok");
    expect(coverageStatus(9, 6)).toBe("ok");
  });

  it("is short below the target and severe under half of it", () => {
    expect(coverageStatus(5, 6)).toBe("short");
    expect(coverageStatus(3, 6)).toBe("short");
    expect(coverageStatus(2, 6)).toBe("severe");
    expect(coverageStatus(0, 6)).toBe("severe");
  });
});

describe("buildCoverageRows", () => {
  const blocks: ShiftBlock[] = [
    block("we-close", "weekend", "7:45p", "11:30p", 4),
    block("wd-open", "weekday", "6:30a", "10:15a", 6),
    block("wd-close", "weekday", "7:45p", "11:30p", 6),
    block("we-morning", "weekend", "8:30a", "11a"),
  ];
  const counts: CellCount[] = [
    { blockId: "wd-open", day: "mon", count: 7 },
    { blockId: "wd-open", day: "tue", count: 2 },
    { blockId: "wd-close", day: "mon", count: 4 },
    { blockId: "we-close", day: "sat", count: 1 },
    { blockId: "we-morning", day: "sun", count: 3 },
  ];

  it("orders weekday blocks first, then by start time", () => {
    const rows = buildCoverageRows(blocks, counts);
    expect(rows.map((r) => r.blockId)).toEqual(["wd-open", "wd-close", "we-morning", "we-close"]);
  });

  it("gives weekday rows five cells and weekend rows two, in day order", () => {
    const rows = buildCoverageRows(blocks, counts);
    expect(rows[0]!.cells.map((c) => c.day)).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    // Sunday opens the scheduling week, so weekend cells run Sun then Sat (PLAN §7).
    expect(rows[2]!.cells.map((c) => c.day)).toEqual(["sun", "sat"]);
  });

  it("fills counts per cell, defaulting missing cells to zero", () => {
    const openRow = buildCoverageRows(blocks, counts)[0]!;
    expect(openRow.cells.map((c) => c.count)).toEqual([7, 2, 0, 0, 0]);
  });

  it("grades each cell against the block target", () => {
    const openRow = buildCoverageRows(blocks, counts)[0]!;
    expect(openRow.cells.map((c) => c.status)).toEqual(["ok", "severe", "severe", "severe", "severe"]);
  });

  it("leaves untargeted blocks status none", () => {
    const morning = buildCoverageRows(blocks, counts).find((r) => r.blockId === "we-morning")!;
    expect(morning.target).toBeNull();
    expect(morning.cells.every((c) => c.status === "none")).toBe(true);
  });

  it("marks the derived close block per day-type and tiers by end time", () => {
    const rows = buildCoverageRows(blocks, counts);
    const byId = new Map(rows.map((r) => [r.blockId, r]));
    expect(byId.get("wd-close")!.isClose).toBe(true);
    expect(byId.get("we-close")!.isClose).toBe(true);
    expect(byId.get("wd-open")!.isClose).toBe(false);
    expect(byId.get("wd-close")!.tier).toBe("night");
    expect(byId.get("wd-open")!.tier).toBe("day");
  });

  it("handles an empty block set", () => {
    expect(buildCoverageRows([], counts)).toEqual([]);
  });
});

describe("summarizeCoverage", () => {
  it("counts targeted cells, short cells, and missing people", () => {
    const rows = buildCoverageRows(
      [block("wd", "weekday", "5p", "8p", 6), block("we", "weekend", "9a", "1p")],
      [
        { blockId: "wd", day: "mon", count: 6 },
        { blockId: "wd", day: "tue", count: 4 },
        { blockId: "we", day: "sat", count: 0 },
      ],
    );
    // Five targeted weekday cells; mon ok, tue short by 2, wed-fri short by 6 each.
    expect(summarizeCoverage(rows)).toEqual({ targetedCells: 5, shortCells: 4, missing: 20 });
  });

  it("is all zeros when no block has a target", () => {
    const rows = buildCoverageRows([block("we", "weekend", "9a", "1p")], []);
    expect(summarizeCoverage(rows)).toEqual({ targetedCells: 0, shortCells: 0, missing: 0 });
  });
});

describe("summarizeAssignedCoverage", () => {
  const cellKey = (blockId: string, day: string) => `${blockId}|${day}`;

  it("grades weekday cells by their count and weekend cells by the needier week", () => {
    const rows = buildCoverageRows(
      [block("wd", "weekday", "5p", "8p", 3), block("we", "weekend", "9a", "1p", 2)],
      [],
    );
    const assigned = new Map([
      [cellKey("wd", "mon"), { a: 3, b: 0 }],
      [cellKey("wd", "tue"), { a: 1, b: 0 }],
      [cellKey("we", "sat"), { a: 2, b: 1 }],
      [cellKey("we", "sun"), { a: 2, b: 2 }],
    ]);
    // Weekday: mon ok, tue short 2, wed-fri short 3 each. Weekend: sat graded on
    // week b (1 of 2, short 1), sun ok.
    expect(summarizeAssignedCoverage(rows, assigned)).toEqual({
      targetedCells: 7,
      shortCells: 5,
      missing: 12,
    });
  });

  it("treats unassigned cells as zero", () => {
    const rows = buildCoverageRows([block("wd", "weekday", "5p", "8p", 1)], []);
    expect(summarizeAssignedCoverage(rows, new Map())).toEqual({
      targetedCells: 5,
      shortCells: 5,
      missing: 5,
    });
  });
});

describe("assignedCellCount", () => {
  it("is zero when nothing is assigned", () => {
    expect(assignedCellCount("weekday", undefined)).toBe(0);
  });
  it("uses the plain count on weekdays and the needier week on weekends", () => {
    expect(assignedCellCount("weekday", { a: 4, b: 0 })).toBe(4);
    expect(assignedCellCount("weekend", { a: 4, b: 2 })).toBe(2);
  });
});
