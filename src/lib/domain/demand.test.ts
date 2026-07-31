import { describe, it, expect } from "vitest";
import {
  highDemandCells,
  demandCellKey,
  DEMAND_TOP_SHARE,
  DEMAND_MIN_CELL_COUNT,
  type CellCount,
} from "./demand";

// 10 weekday shifts, no targets set. The absolute floor (3) drops counts 1 and 2;
// 7 remain and rank by count, top 25% = ceil(1.75) = 2, so the two busiest flag.
const weekday: CellCount[] = [
  { blockId: "b1", day: "mon", count: 30 },
  { blockId: "b1", day: "tue", count: 10 },
  { blockId: "b2", day: "mon", count: 25 },
  { blockId: "b2", day: "tue", count: 8 },
  { blockId: "b3", day: "mon", count: 5 },
  { blockId: "b4", day: "mon", count: 4 },
  { blockId: "b5", day: "mon", count: 3 },
  { blockId: "b6", day: "mon", count: 2 },
  { blockId: "b7", day: "mon", count: 1 },
  { blockId: "b8", day: "mon", count: 1 },
];

describe("highDemandCells", () => {
  it("flags the busiest ~25% of a day-type's shifts when no targets are set", () => {
    const cells = highDemandCells(weekday);
    expect(cells.has(demandCellKey("b1", "mon"))).toBe(true); // 30, busiest
    expect(cells.has(demandCellKey("b2", "mon"))).toBe(true); // 25, second
    expect(cells.has(demandCellKey("b1", "tue"))).toBe(false); // 10
    expect(cells.size).toBe(2);
  });

  it("has no cohort-size floor: a thin cohort can flag a target-met cell", () => {
    // Three responders, one cell, target 1: clears both floors (abs 3 and target 1).
    const cells = highDemandCells([{ blockId: "b2", day: "wed", count: 3 }], {
      targets: new Map([["b2", 1]]),
    });
    expect(cells.has(demandCellKey("b2", "wed"))).toBe(true);
  });

  it("gates each cell on its own target being met", () => {
    const counts: CellCount[] = [
      { blockId: "b1", day: "mon", count: 4 }, // target 4 -> met
      { blockId: "b2", day: "mon", count: 3 }, // target 5 -> NOT met, excluded
      { blockId: "b3", day: "mon", count: 5 }, // target 5 -> met
    ];
    const targets = new Map<string, number | null>([
      ["b1", 4],
      ["b2", 5],
      ["b3", 5],
    ]);
    const cells = highDemandCells(counts, { targets });
    expect(cells.has(demandCellKey("b2", "mon"))).toBe(false); // under target
    // b1 (4/4=1.0) and b3 (5/5=1.0) both met and tied on contention.
    expect(cells.has(demandCellKey("b1", "mon"))).toBe(true);
    expect(cells.has(demandCellKey("b3", "mon"))).toBe(true);
  });

  it("ranks by contention (takers/target), not raw popularity", () => {
    const counts: CellCount[] = [
      { blockId: "big", day: "mon", count: 6 }, // 6/6 = 1.0
      { blockId: "tight", day: "mon", count: 5 }, // 5/2 = 2.5, more contended
    ];
    const targets = new Map<string, number | null>([
      ["big", 6],
      ["tight", 2],
    ]);
    // 2 eligible, top 25% = ceil(0.5) = 1 => only the most contended (tight), even
    // though it has fewer raw takers than big.
    const cells = highDemandCells(counts, { targets });
    expect(cells.has(demandCellKey("tight", "mon"))).toBe(true);
    expect(cells.has(demandCellKey("big", "mon"))).toBe(false);
    expect(cells.size).toBe(1);
  });

  it("applies an absolute floor so a tiny target can't flag on one or two picks", () => {
    // count 2 meets a target of 1, but the absolute floor (3) keeps it out.
    const cells = highDemandCells([{ blockId: "b1", day: "mon", count: 2 }], {
      targets: new Map([["b1", 1]]),
    });
    expect(cells.size).toBe(0);
  });

  it("includes every shift tied at the cutoff contention", () => {
    // All three at ratio 1.0 (exactly met); ties at the cutoff all flag.
    const counts: CellCount[] = [
      { blockId: "b1", day: "mon", count: 5 }, // 5/5 = 1.0
      { blockId: "b2", day: "mon", count: 4 }, // 4/4 = 1.0
      { blockId: "b3", day: "mon", count: 3 }, // 3/3 = 1.0
    ];
    const targets = new Map<string, number | null>([
      ["b1", 5],
      ["b2", 4],
      ["b3", 3],
    ]);
    const cells = highDemandCells(counts, { targets });
    expect(cells.size).toBe(3);
  });

  it("ranks each day-type separately, so weekend shifts aren't buried by weekday", () => {
    const counts: CellCount[] = [
      ...weekday,
      { blockId: "w1", day: "sat", count: 6 },
      { blockId: "w1", day: "sun", count: 5 },
      { blockId: "w2", day: "sat", count: 4 },
      { blockId: "w2", day: "sun", count: 3 },
      { blockId: "w3", day: "sat", count: 2 },
    ];
    const cells = highDemandCells(counts);
    // 4 weekend shifts clear the abs floor (6,5,4,3); top 25% = ceil(1) = 1 => the
    // busiest (6) flags despite low absolute counts next to weekday.
    expect(cells.has(demandCellKey("w1", "sat"))).toBe(true); // 6
    expect(cells.has(demandCellKey("w1", "sun"))).toBe(false); // 5
    // Weekday winners unchanged.
    expect(cells.has(demandCellKey("b1", "mon"))).toBe(true);
    expect(cells.has(demandCellKey("b2", "mon"))).toBe(true);
  });

  it("uses the documented defaults", () => {
    expect(DEMAND_TOP_SHARE).toBe(0.25);
    expect(DEMAND_MIN_CELL_COUNT).toBe(3);
  });
});
