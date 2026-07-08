import { describe, it, expect } from "vitest";
import { weekendCandidates, needsWeekendAutoAssign, chooseWeekendAutoAssign } from "./auto-assign";
import type { Position, ShiftBlock, SelectedShift } from "./types";

function block(id: string, dayType: "weekday" | "weekend"): ShiftBlock {
  return { id, positionId: "p", dayType, start: 510, end: 660 };
}

const blocks: ShiftBlock[] = [
  block("wd", "weekday"),
  block("we-a", "weekend"),
  block("we-b", "weekend"),
];

const position: Position = {
  id: "p",
  name: "P",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};

describe("weekendCandidates", () => {
  it("is every weekend block crossed with Sat and Sun", () => {
    expect(weekendCandidates(blocks)).toEqual([
      { blockId: "we-a", day: "sat" },
      { blockId: "we-a", day: "sun" },
      { blockId: "we-b", day: "sat" },
      { blockId: "we-b", day: "sun" },
    ]);
  });

  it("is empty for a weekday-only position", () => {
    expect(weekendCandidates([block("wd", "weekday")])).toEqual([]);
  });
});

describe("needsWeekendAutoAssign", () => {
  it("is true when a non-exempt selection has no weekend cell", () => {
    const sel: SelectedShift[] = [{ blockId: "wd", day: "mon" }];
    expect(needsWeekendAutoAssign(sel, position)).toBe(true);
  });

  it("is false once any weekend cell is selected", () => {
    const sel: SelectedShift[] = [{ blockId: "we-a", day: "sat" }];
    expect(needsWeekendAutoAssign(sel, position)).toBe(false);
  });

  it("is false for a weekend-exempt position (Barista)", () => {
    const sel: SelectedShift[] = [{ blockId: "wd", day: "mon" }];
    expect(needsWeekendAutoAssign(sel, { ...position, weekendExempt: true })).toBe(false);
  });
});

describe("chooseWeekendAutoAssign", () => {
  it("picks a candidate using the injected index", () => {
    expect(chooseWeekendAutoAssign(blocks, { pick: () => 2 })).toEqual({
      blockId: "we-b",
      day: "sat",
    });
  });

  it("reuses a still-valid preferred cell for stability across re-submits", () => {
    const preferred: SelectedShift = { blockId: "we-b", day: "sun" };
    // pick would choose index 0, but the preferred cell wins.
    expect(chooseWeekendAutoAssign(blocks, { preferred, pick: () => 0 })).toEqual(preferred);
  });

  it("ignores a preferred cell that is no longer a candidate", () => {
    const preferred: SelectedShift = { blockId: "gone", day: "sat" };
    expect(chooseWeekendAutoAssign(blocks, { preferred, pick: () => 0 })).toEqual({
      blockId: "we-a",
      day: "sat",
    });
  });

  it("returns null when there are no weekend blocks", () => {
    expect(chooseWeekendAutoAssign([block("wd", "weekday")])).toBeNull();
  });
});
