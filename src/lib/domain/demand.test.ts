import { describe, it, expect } from "vitest";
import {
  highDemandCells,
  highDemandBlockIds,
  demandCellKey,
  DEMAND_MIN_RESPONDERS,
  DEMAND_THRESHOLD,
  type CellCount,
} from "./demand";

const counts: CellCount[] = [
  { blockId: "b1", day: "mon", count: 12 }, // 12/20 = 0.60
  { blockId: "b1", day: "tue", count: 11 }, // 11/20 = 0.55
  { blockId: "b2", day: "wed", count: 19 }, // 19/20 = 0.95
];

describe("highDemandCells", () => {
  it("returns nothing until the position reaches the responder floor", () => {
    // 19 responders, and one cell at 100%, still below the 20-responder floor.
    expect(highDemandCells([{ blockId: "b2", day: "wed", count: 19 }], 19).size).toBe(0);
  });

  it("flags a cell once its share reaches the threshold", () => {
    const cells = highDemandCells(counts, 20);
    expect(cells.has(demandCellKey("b1", "mon"))).toBe(true); // 0.60 meets 0.60
    expect(cells.has(demandCellKey("b1", "tue"))).toBe(false); // 0.55
    expect(cells.has(demandCellKey("b2", "wed"))).toBe(true); // 0.95
    expect(cells.size).toBe(2);
  });

  it("honors custom threshold + floor options", () => {
    const cells = highDemandCells([{ blockId: "b1", day: "mon", count: 5 }], 10, {
      minResponders: 10,
      threshold: 0.5,
    });
    expect(cells.has(demandCellKey("b1", "mon"))).toBe(true);
  });

  it("uses the documented defaults", () => {
    expect(DEMAND_MIN_RESPONDERS).toBe(20);
    expect(DEMAND_THRESHOLD).toBe(0.6);
  });
});

describe("highDemandBlockIds", () => {
  it("marks a block high-demand when any of its day cells crosses the threshold", () => {
    const blocks = highDemandBlockIds(counts, 20);
    expect([...blocks].sort()).toEqual(["b1", "b2"]);
  });

  it("is empty below the responder floor", () => {
    expect(highDemandBlockIds(counts, 5).size).toBe(0);
  });
});
