import { describe, it, expect } from "vitest";
import { parseTime, type TimeRange } from "./time";
import { maxNonOverlappingMinutes } from "./packing";

const r = (s: string, e: string): TimeRange => ({ start: parseTime(s), end: parseTime(e) });

describe("maxNonOverlappingMinutes", () => {
  it("is zero for no ranges", () => {
    expect(maxNonOverlappingMinutes([])).toBe(0);
  });

  it("returns the duration of a single range", () => {
    expect(maxNonOverlappingMinutes([r("6:30a", "10:15a")])).toBe(225);
  });

  it("picks the longer of two overlapping ranges", () => {
    expect(maxNonOverlappingMinutes([r("6:30a", "10:15a"), r("9:45a", "12:45p")])).toBe(225);
  });

  it("sums two disjoint ranges", () => {
    expect(maxNonOverlappingMinutes([r("6:30a", "10:15a"), r("12:30p", "2:30p")])).toBe(225 + 120);
  });

  it("treats touching endpoints as compatible", () => {
    expect(maxNonOverlappingMinutes([r("6a", "10a"), r("10a", "2p")])).toBe(240 + 240);
  });

  it("chooses the best combination, not the greedy longest-first", () => {
    // {b1 225 + b3 120 = 345} beats the single middle block {b2 165}.
    const ranges = [r("6:30a", "10:15a"), r("10a", "12:45p"), r("12:30p", "2:30p")];
    expect(maxNonOverlappingMinutes(ranges)).toBe(345);
  });
});
