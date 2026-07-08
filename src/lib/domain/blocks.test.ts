import { describe, it, expect } from "vitest";
import { parseTime } from "./time";
import { deriveOpenClose, isOpenBlock, isCloseBlock } from "./blocks";
import type { ShiftBlock } from "./types";

function block(id: string, start: string, end: string): ShiftBlock {
  return {
    id,
    positionId: "ca",
    dayType: "weekday",
    start: parseTime(start),
    end: parseTime(end),
  };
}

// Culinary Assistant weekday blocks (PLAN.md §6.3), deliberately out of order.
const caWeekday: ShiftBlock[] = [
  block("b3", "12:30p", "2:30p"),
  block("b6", "7:45p", "11:30p"),
  block("b1", "6:30a", "10:15a"),
  block("b2", "10a", "12:45p"),
  block("b5", "4:45p", "8p"),
  block("b4", "2:15p", "5p"),
];

describe("deriveOpenClose", () => {
  it("picks earliest-starting block as open and latest-ending as close", () => {
    const { openId, closeId } = deriveOpenClose(caWeekday);
    expect(openId).toBe("b1"); // 6:30a is earliest start
    expect(closeId).toBe("b6"); // 11:30p is latest end
  });

  it("returns nulls for an empty block set (e.g. Barista weekend)", () => {
    expect(deriveOpenClose([])).toEqual({ openId: null, closeId: null });
  });

  it("can resolve open and close to the same single block", () => {
    const only = [block("solo", "9a", "5p")];
    expect(deriveOpenClose(only)).toEqual({ openId: "solo", closeId: "solo" });
  });
});

describe("isOpenBlock / isCloseBlock", () => {
  it("identifies the derived open and close blocks", () => {
    expect(isOpenBlock("b1", caWeekday)).toBe(true);
    expect(isOpenBlock("b2", caWeekday)).toBe(false);
    expect(isCloseBlock("b6", caWeekday)).toBe(true);
    expect(isCloseBlock("b1", caWeekday)).toBe(false);
  });
});
