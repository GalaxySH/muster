import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULING_PARAMS,
  parseSchedulingParams,
  validateSchedulingParams,
} from "./params";

describe("validateSchedulingParams", () => {
  it("accepts the defaults and sensible values", () => {
    expect(validateSchedulingParams(DEFAULT_SCHEDULING_PARAMS)).toBeNull();
    expect(
      validateSchedulingParams({ dayCapHours: 6, nightPriority: 100, eveningPriority: 0 }),
    ).toBeNull();
  });

  it("rejects a day cap outside 1 to 16 or fractional", () => {
    for (const dayCapHours of [0, 17, 7.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, dayCapHours });
      expect(msg).toMatch(/Max hours per day/);
      expect(msg).not.toMatch(/—/);
    }
  });

  it("rejects priorities outside 0 to 100 or fractional", () => {
    for (const nightPriority of [-1, 101, 49.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, nightPriority });
      expect(msg).toMatch(/Priorities/);
    }
    expect(
      validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, eveningPriority: 101 }),
    ).not.toBeNull();
  });
});

describe("parseSchedulingParams", () => {
  it("falls back to the defaults for missing or broken values", () => {
    expect(parseSchedulingParams(null)).toEqual(DEFAULT_SCHEDULING_PARAMS);
    expect(parseSchedulingParams("not json")).toEqual(DEFAULT_SCHEDULING_PARAMS);
    expect(parseSchedulingParams('"a string"')).toEqual(DEFAULT_SCHEDULING_PARAMS);
    expect(parseSchedulingParams('{"dayCapHours": 99}')).toEqual(DEFAULT_SCHEDULING_PARAMS);
  });

  it("fills missing fields from the defaults", () => {
    expect(parseSchedulingParams('{"dayCapHours": 6}')).toEqual({
      dayCapHours: 6,
      nightPriority: 50,
      eveningPriority: 25,
    });
  });

  it("round-trips a full valid value", () => {
    const params = { dayCapHours: 10, nightPriority: 80, eveningPriority: 10 };
    expect(parseSchedulingParams(JSON.stringify(params))).toEqual(params);
  });
});
