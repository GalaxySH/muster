import { describe, it, expect } from "vitest";
import { mergeRanges, coveredMinutes, redundantRangeIndex } from "./intervals";
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

  it("extends the assigned block instead of double-counting the overlap", () => {
    // A 2p–5p block + an overlapping 4p–8p shift extends to 2p–8p (6h), not 7h.
    expect(coveredMinutes([r("2p", "5p"), r("4p", "8p")])).toBe(360);
  });

  it("counts a fully-nested shift only once", () => {
    expect(coveredMinutes([r("2p", "8p"), r("4p", "6p")])).toBe(360);
  });
});

describe("redundantRangeIndex", () => {
  it("finds no redundancy in a staggered pair", () => {
    expect(redundantRangeIndex([r("12p", "4p"), r("3:45p", "7:45p")])).toBe(-1);
  });

  it("finds no redundancy in disjoint or touching ranges", () => {
    expect(redundantRangeIndex([r("8a", "10a"), r("12p", "2p")])).toBe(-1);
    expect(redundantRangeIndex([r("8a", "12p"), r("12p", "4p")])).toBe(-1);
  });

  it("reports the first of an identical pair", () => {
    expect(redundantRangeIndex([r("10a", "2p"), r("10a", "2p")])).toBe(0);
  });

  it("reports a nested range, containment sharing an endpoint included", () => {
    expect(redundantRangeIndex([r("2p", "8p"), r("4p", "6p")])).toBe(1);
    expect(redundantRangeIndex([r("12p", "2p"), r("10a", "2p")])).toBe(0);
  });

  it("reports a range covered only by the union of two others", () => {
    // 12p-3p and 2:45p-6p together cover all of 1p-5p, though neither does alone.
    expect(redundantRangeIndex([r("12p", "3p"), r("2:45p", "6p"), r("1p", "5p")])).toBe(2);
  });

  it("does not treat the hull as coverage: a range between two disjoint ones stands", () => {
    expect(redundantRangeIndex([r("8a", "10a"), r("4p", "6p"), r("12p", "2p")])).toBe(-1);
  });

  it("never flags a single range", () => {
    expect(redundantRangeIndex([r("8a", "10a")])).toBe(-1);
  });
});
