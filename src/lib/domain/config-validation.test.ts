import { describe, it, expect } from "vitest";
import { parseTime } from "./time";
import {
  DESIRED_CAPACITY_MAX,
  blockSetWarnings,
  validateBlockTimes,
  validateDesiredCapacity,
} from "./config-validation";
import type { DayType, Position, ShiftBlock } from "./types";

describe("validateDesiredCapacity", () => {
  it("accepts null as no target", () => {
    expect(validateDesiredCapacity(null)).toBeNull();
  });

  it("accepts the bounds", () => {
    expect(validateDesiredCapacity(1)).toBeNull();
    expect(validateDesiredCapacity(DESIRED_CAPACITY_MAX)).toBeNull();
  });

  it("rejects zero, negatives, and values past the max", () => {
    expect(validateDesiredCapacity(0)).toMatch(/./);
    expect(validateDesiredCapacity(-3)).toMatch(/./);
    expect(validateDesiredCapacity(DESIRED_CAPACITY_MAX + 1)).toMatch(/./);
  });

  it("rejects fractions and NaN", () => {
    expect(validateDesiredCapacity(5.5)).toMatch(/./);
    expect(validateDesiredCapacity(Number.NaN)).toMatch(/./);
  });

  it("writes a plain message without em dashes", () => {
    expect(validateDesiredCapacity(0)).not.toContain("—");
  });
});

describe("validateBlockTimes", () => {
  it("accepts a normal daytime range", () => {
    expect(validateBlockTimes(parseTime("8a"), parseTime("12p"))).toBeNull();
  });

  it("accepts the full-day extremes (midnight to midnight)", () => {
    expect(validateBlockTimes(0, 1440)).toBeNull();
  });

  it("rejects a negative start", () => {
    expect(validateBlockTimes(-1, 60)).toMatch(/./);
  });

  it("rejects an end past midnight", () => {
    expect(validateBlockTimes(600, 1441)).toMatch(/./);
  });

  it("rejects a zero-length block", () => {
    expect(validateBlockTimes(600, 600)).toMatch(/./);
  });

  it("rejects an inverted range", () => {
    expect(validateBlockTimes(720, 480)).toMatch(/./);
  });

  it("rejects fractional minutes", () => {
    expect(validateBlockTimes(600.5, 720)).toMatch(/./);
    expect(validateBlockTimes(600, Number.NaN)).toMatch(/./);
  });
});

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "ca",
    name: "Culinary Assistant",
    minHours: 10,
    minDays: 2,
    weekendExempt: false,
    ...overrides,
  };
}

function block(id: string, dayType: DayType, start: string, end: string): ShiftBlock {
  return { id, positionId: "ca", dayType, start: parseTime(start), end: parseTime(end) };
}

const kinds = (warnings: ReturnType<typeof blockSetWarnings>) => warnings.map((w) => w.kind);

describe("blockSetWarnings", () => {
  it("warns when a non-exempt position has no weekend blocks", () => {
    const warnings = blockSetWarnings(position(), [block("wd", "weekday", "8a", "6p")]);
    expect(kinds(warnings)).toContain("no_weekend_blocks");
  });

  it("does not warn about weekends for a weekend-exempt position", () => {
    const warnings = blockSetWarnings(position({ weekendExempt: true }), [
      block("wd", "weekday", "8a", "6p"),
    ]);
    expect(kinds(warnings)).not.toContain("no_weekend_blocks");
  });

  it("does not warn about weekends when a weekend block exists", () => {
    const warnings = blockSetWarnings(position(), [
      block("wd", "weekday", "8a", "6p"),
      block("we", "weekend", "9a", "1p"),
    ]);
    expect(kinds(warnings)).not.toContain("no_weekend_blocks");
  });

  it("warns when even a full selection stays below the min-hours floor", () => {
    // One 1h weekday block: 5 x 60m = 300m = 5h a week, under the 10h floor.
    const warnings = blockSetWarnings(position({ weekendExempt: true }), [
      block("wd", "weekday", "8a", "9a"),
    ]);
    expect(kinds(warnings)).toContain("min_hours_unreachable");
    const warning = warnings.find((w) => w.kind === "min_hours_unreachable")!;
    expect(warning.message).toContain("5h");
    expect(warning.message).toContain("10h");
  });

  it("does not warn when the floor is reachable", () => {
    // 4h weekday block: 5 x 240m = 1200m = 20h, over the 10h floor.
    const warnings = blockSetWarnings(position({ weekendExempt: true }), [
      block("wd", "weekday", "8a", "12p"),
    ]);
    expect(kinds(warnings)).not.toContain("min_hours_unreachable");
  });

  it("counts overlapping blocks as covered time, not summed time", () => {
    // Two identical 100m blocks cover 100m, not 200m: 5 x 100m = 500m < 600m.
    const warnings = blockSetWarnings(position({ weekendExempt: true }), [
      block("wd-a", "weekday", "8a", "9:40a"),
      block("wd-b", "weekday", "8a", "9:40a"),
    ]);
    expect(kinds(warnings)).toContain("min_hours_unreachable");
  });

  it("cycle-averages weekend coverage: both days summed, then halved", () => {
    // 10h weekend block: (600m + 600m) x 0.5 = 600m = exactly the 10h floor.
    const reachable = blockSetWarnings(position(), [block("we", "weekend", "9a", "7p")]);
    expect(kinds(reachable)).not.toContain("min_hours_unreachable");

    // 9h weekend block: (540m + 540m) x 0.5 = 540m = 9h, under the floor.
    const unreachable = blockSetWarnings(position(), [block("we", "weekend", "9a", "6p")]);
    expect(kinds(unreachable)).toContain("min_hours_unreachable");
  });

  it("warns twice for an empty block set on a non-exempt position", () => {
    const warnings = blockSetWarnings(position(), []);
    expect(kinds(warnings).sort()).toEqual(["min_hours_unreachable", "no_weekend_blocks"]);
  });

  it("writes plain messages without em dashes", () => {
    for (const w of blockSetWarnings(position(), [])) {
      expect(w.message).not.toContain("—");
    }
  });
});
