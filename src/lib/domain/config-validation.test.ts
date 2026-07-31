import { describe, it, expect } from "vitest";
import { parseTime } from "./time";
import {
  DESIRED_CAPACITY_MAX,
  blockSetWarnings,
  positionCapacityCheck,
  seatHoursPerWeek,
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

function block(
  id: string,
  dayType: DayType,
  start: string,
  end: string,
  desiredCapacity: number | null = null,
): ShiftBlock {
  return {
    id,
    positionId: "ca",
    dayType,
    start: parseTime(start),
    end: parseTime(end),
    desiredCapacity,
  };
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

  it("warns when a position has no weekday blocks", () => {
    const warnings = blockSetWarnings(position(), [block("we", "weekend", "9a", "7p")]);
    expect(kinds(warnings)).toContain("no_weekday_blocks");
  });

  it("does not warn about weekdays when a weekday block exists", () => {
    const warnings = blockSetWarnings(position(), [block("wd", "weekday", "8a", "6p")]);
    expect(kinds(warnings)).not.toContain("no_weekday_blocks");
  });

  it("warns when the blocks cannot span the position's day floor", () => {
    // A 3-day floor (Shift Lead) with only weekend blocks: 2 weekend days max.
    const warnings = blockSetWarnings(position({ minDays: 3 }), [
      block("we", "weekend", "9a", "9p"),
    ]);
    expect(kinds(warnings)).toContain("min_days_unreachable");
    const warning = warnings.find((w) => w.kind === "min_days_unreachable")!;
    expect(warning.message).toContain("2");
    expect(warning.message).toContain("3");
  });

  it("does not warn about days when a weekday layout can reach the floor", () => {
    // Weekday blocks open all five weekdays, over the 3-day floor.
    const warnings = blockSetWarnings(position({ minDays: 3 }), [
      block("wd", "weekday", "8a", "6p"),
      block("we", "weekend", "9a", "1p"),
    ]);
    expect(kinds(warnings)).not.toContain("min_days_unreachable");
  });

  it("warns about everything wrong with an empty block set on a non-exempt position", () => {
    const warnings = blockSetWarnings(position(), []);
    expect(kinds(warnings).sort()).toEqual([
      "min_days_unreachable",
      "min_hours_unreachable",
      "no_weekday_blocks",
      "no_weekend_blocks",
    ]);
  });

  it("writes plain messages without em dashes", () => {
    for (const w of blockSetWarnings(position(), [])) {
      expect(w.message).not.toContain("—");
    }
  });
});

describe("positionCapacityCheck", () => {
  it("says no targets when no block has one", () => {
    expect(positionCapacityCheck([block("wd", "weekday", "8a", "6p")], 5, 10)).toEqual({
      kind: "no_targets",
    });
    expect(positionCapacityCheck([], 5, 10)).toEqual({ kind: "no_targets" });
  });

  it("passes when the weekly seat hours cover every student's minimum", () => {
    // 2 seats x 10h x 5 weekdays = 100 seat hours; 10 students x 10h = 100.
    expect(positionCapacityCheck([block("wd", "weekday", "8a", "6p", 2)], 10, 10)).toEqual({
      kind: "ok",
      supplyHours: 100,
      demandHours: 100,
    });
  });

  it("reports a shortfall with the weekly numbers", () => {
    // 2 seats x 4h x 5 weekdays = 40 seat hours; 5 students x 10h = 50.
    const result = positionCapacityCheck([block("wd", "weekday", "8a", "12p", 2)], 5, 10);
    expect(result.kind).toBe("short");
    if (result.kind !== "short") return;
    expect(result.supplyHours).toBe(40);
    expect(result.demandHours).toBe(50);
    expect(result.message).toContain("40");
    expect(result.message).toContain("50");
  });

  it("counts weekend seats on both days at full weight", () => {
    // 1 seat x 10h x 2 weekend days = 20 seat hours; 2 students x 10h = 20.
    expect(positionCapacityCheck([block("we", "weekend", "9a", "7p", 1)], 2, 10).kind).toBe("ok");
    // One fewer weekly hour of demand coverage tips it: 3 students need 30 > 20.
    expect(positionCapacityCheck([block("we", "weekend", "9a", "7p", 1)], 3, 10).kind).toBe(
      "short",
    );
  });

  it("counts blocks without a target as zero seats", () => {
    // Only the targeted block supplies seats: 1 x 4h x 5 = 20, under 3 x 10h = 30.
    const result = positionCapacityCheck(
      [block("wd-a", "weekday", "8a", "12p", 1), block("wd-b", "weekday", "8a", "6p")],
      3,
      10,
    );
    expect(result.kind).toBe("short");
  });

  it("writes singular copy for one student, without em dashes", () => {
    const result = positionCapacityCheck([block("wd", "weekday", "8a", "9a", 1)], 1, 10);
    expect(result.kind).toBe("short");
    if (result.kind !== "short") return;
    expect(result.message).toContain("1 rostered student needs");
    expect(result.message).not.toContain("—");
  });
});

describe("seatHoursPerWeek", () => {
  it("sums each block's target x length x days, weekends on both days", () => {
    // 2 seats x 10h x 5 weekdays = 100, plus 1 seat x 4h x 2 weekend days = 8.
    expect(
      seatHoursPerWeek([
        block("wd", "weekday", "8a", "6p", 2),
        block("we", "weekend", "9a", "1p", 1),
      ]),
    ).toBe(108);
  });

  it("counts a block with no target as zero, so no targets means zero", () => {
    expect(seatHoursPerWeek([block("wd", "weekday", "8a", "6p")])).toBe(0);
    expect(seatHoursPerWeek([])).toBe(0);
  });
});
