import { describe, it, expect } from "vitest";
import {
  highDemandCells,
  demandCellKey,
  DEMAND_MIN_RESPONDERS,
  DEMAND_TOP_SHARE,
  type CellCount,
} from "./demand";

// 10 weekday shifts. Top 15% = ceil(1.5) = 2, so the two busiest are flagged.
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
  it("returns nothing until the position reaches the responder floor", () => {
    // 19 responders, one cell at 100% share, still below the 20-responder floor.
    expect(highDemandCells([{ blockId: "b2", day: "wed", count: 19 }], 19).size).toBe(0);
  });

  it("flags the busiest ~15% of a day-type's shifts", () => {
    const cells = highDemandCells(weekday, 40);
    expect(cells.has(demandCellKey("b1", "mon"))).toBe(true); // 30, busiest
    expect(cells.has(demandCellKey("b2", "mon"))).toBe(true); // 25, second
    expect(cells.has(demandCellKey("b1", "tue"))).toBe(false); // 10
    expect(cells.size).toBe(2);
  });

  it("includes every shift tied at the cutoff count", () => {
    const tied: CellCount[] = [
      { blockId: "b1", day: "mon", count: 30 },
      { blockId: "b2", day: "mon", count: 25 },
      { blockId: "b3", day: "mon", count: 25 }, // tied with the cutoff shift
      { blockId: "b4", day: "mon", count: 5 },
      { blockId: "b5", day: "mon", count: 4 },
      { blockId: "b6", day: "mon", count: 3 },
      { blockId: "b7", day: "mon", count: 2 },
      { blockId: "b8", day: "mon", count: 1 },
    ];
    // 8 shifts, top 15% = ceil(1.2) = 2, cutoff count = 25, so both 25s flag too.
    const cells = highDemandCells(tied, 40);
    expect(cells.size).toBe(3);
    expect(cells.has(demandCellKey("b3", "mon"))).toBe(true);
  });

  it("ranks each day-type separately, so weekend shifts aren't buried by weekday", () => {
    const counts: CellCount[] = [
      ...weekday,
      { blockId: "w1", day: "sat", count: 6 },
      { blockId: "w1", day: "sun", count: 5 },
      { blockId: "w2", day: "sat", count: 4 },
      { blockId: "w2", day: "sun", count: 3 },
      { blockId: "w3", day: "sat", count: 2 },
      { blockId: "w4", day: "sat", count: 1 },
      { blockId: "w5", day: "sat", count: 1 },
    ];
    const cells = highDemandCells(counts, 40);
    // 7 weekend shifts, top 15% = ceil(1.05) = 2, flagged despite low absolute counts.
    expect(cells.has(demandCellKey("w1", "sat"))).toBe(true); // 6
    expect(cells.has(demandCellKey("w1", "sun"))).toBe(true); // 5
    expect(cells.has(demandCellKey("w2", "sat"))).toBe(false); // 4
    // Weekday winners unchanged.
    expect(cells.has(demandCellKey("b1", "mon"))).toBe(true);
    expect(cells.has(demandCellKey("b2", "mon"))).toBe(true);
  });

  it("honors custom topShare + floor options", () => {
    const cells = highDemandCells(weekday, 10, { minResponders: 10, topShare: 0.5 });
    // 10 shifts, top 50% = 5 busiest: 30, 25, 10, 8, 5.
    expect(cells.size).toBe(5);
    expect(cells.has(demandCellKey("b3", "mon"))).toBe(true); // 5, the 5th busiest
    expect(cells.has(demandCellKey("b4", "mon"))).toBe(false); // 4
  });

  it("uses the documented defaults", () => {
    expect(DEMAND_MIN_RESPONDERS).toBe(20);
    expect(DEMAND_TOP_SHARE).toBe(0.15);
  });
});
