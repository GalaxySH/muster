import { describe, it, expect } from "vitest";
import { mergeRanges, coveredMinutes } from "./intervals";
import { parseTime, type TimeRange } from "./time";

const r = (start: string, end: string): TimeRange => ({
  start: parseTime(start),
  end: parseTime(end),
});

describe("mergeRanges", () => {
  it("returns nothing for an empty list", () => {
    expect(mergeRanges([])).toEqual([]);
  });

  it("keeps disjoint ranges separate", () => {
    expect(mergeRanges([r("6:30a", "10:15a"), r("12:30p", "2:30p")])).toEqual([
      r("6:30a", "10:15a"),
      r("12:30p", "2:30p"),
    ]);
  });

  it("merges staggered ranges that overlap by a handoff", () => {
    // 10:00a–10:15a handoff overlap → one 6:30a–12:45p span.
    expect(mergeRanges([r("6:30a", "10:15a"), r("10a", "12:45p")])).toEqual([r("6:30a", "12:45p")]);
  });

  it("merges exactly-touching ranges", () => {
    expect(mergeRanges([r("2p", "5p"), r("5p", "10p")])).toEqual([r("2p", "10p")]);
  });

  it("absorbs a fully nested range and ignores input order", () => {
    expect(mergeRanges([r("10a", "12:45p"), r("10a", "2p")])).toEqual([r("10a", "2p")]);
  });
});

describe("coveredMinutes", () => {
  it("sums disjoint ranges", () => {
    expect(coveredMinutes([r("6:30a", "10:15a"), r("12:30p", "2:30p")])).toBe(225 + 120);
  });

  it("counts a handoff overlap once (the bug fix)", () => {
    // 6:30a–10:15a (225) + 10a–12:45p (165) overlap 15m → 6:30a–12:45p = 375m, not 390.
    expect(coveredMinutes([r("6:30a", "10:15a"), r("10a", "12:45p")])).toBe(375);
  });

  it("credits both touching shifts in full", () => {
    expect(coveredMinutes([r("2p", "5p"), r("5p", "10p")])).toBe(180 + 300);
  });
});
