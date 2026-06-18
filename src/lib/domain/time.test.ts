import { describe, it, expect } from "vitest";
import { parseTime, formatTime, minutesBetween, overlaps, type TimeRange } from "./time";

describe("parseTime", () => {
  it("parses am times", () => {
    expect(parseTime("6:45a")).toBe(6 * 60 + 45);
    expect(parseTime("6a")).toBe(6 * 60);
    expect(parseTime("10:15a")).toBe(10 * 60 + 15);
  });

  it("parses pm times", () => {
    expect(parseTime("12:45p")).toBe(12 * 60 + 45);
    expect(parseTime("8p")).toBe(20 * 60);
    expect(parseTime("11:30p")).toBe(23 * 60 + 30);
  });

  it("handles the 12am / 12pm boundary", () => {
    expect(parseTime("12a")).toBe(0);
    expect(parseTime("12p")).toBe(12 * 60);
  });

  it("rejects malformed input", () => {
    expect(() => parseTime("25:00a")).toThrow();
    expect(() => parseTime("6:60p")).toThrow();
    expect(() => parseTime("6")).toThrow();
    expect(() => parseTime("noon")).toThrow();
  });
});

describe("formatTime", () => {
  it("round-trips with parseTime", () => {
    for (const t of ["6:45a", "6a", "12:45p", "8p", "11:30p", "12a", "12p"]) {
      expect(formatTime(parseTime(t))).toBe(t);
    }
  });
});

describe("minutesBetween", () => {
  it("computes duration of a range", () => {
    expect(minutesBetween({ start: parseTime("6:45a"), end: parseTime("10a") })).toBe(195);
    expect(minutesBetween({ start: parseTime("7:45p"), end: parseTime("11:30p") })).toBe(225);
  });
});

describe("overlaps", () => {
  const r = (s: string, e: string): TimeRange => ({ start: parseTime(s), end: parseTime(e) });

  it("detects overlapping ranges", () => {
    expect(overlaps(r("6:45a", "10a"), r("9:45a", "12:45p"))).toBe(true);
  });

  it("treats touching endpoints as non-overlapping", () => {
    expect(overlaps(r("6:45a", "10a"), r("10a", "12:45p"))).toBe(false);
  });

  it("detects disjoint ranges", () => {
    expect(overlaps(r("6:45a", "10a"), r("12:30p", "2:30p"))).toBe(false);
  });
});
