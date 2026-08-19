import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULING_PARAMS,
  parseSchedulingParams,
  storedSchedulingParams,
  validateSchedulingParams,
} from "./params";

describe("validateSchedulingParams", () => {
  it("accepts the defaults and sensible values", () => {
    expect(validateSchedulingParams(DEFAULT_SCHEDULING_PARAMS)).toBeNull();
    expect(
      validateSchedulingParams({
        ...DEFAULT_SCHEDULING_PARAMS,
        dayCapHours: 6,
        nightPriority: 100,
        eveningPriority: 0,
      }),
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

  it("ships the documented defaults, all nine pinned", () => {
    expect(DEFAULT_SCHEDULING_PARAMS).toEqual({
      dayCapHours: 8,
      nightPriority: 50,
      eveningPriority: 25,
      repeatStartPenalty: 0,
      minRestHours: 8,
      preferredRestHours: 10,
      maxConsecutiveDays: 5,
      maxDaysPerWeek: 6,
      preferredDaysPerWeek: 5,
    });
  });

  it("accepts every field exactly at its bounds", () => {
    expect(
      validateSchedulingParams({
        dayCapHours: 16,
        nightPriority: 100,
        eveningPriority: 100,
        repeatStartPenalty: 100,
        minRestHours: 16,
        preferredRestHours: 16,
        maxConsecutiveDays: 14,
        maxDaysPerWeek: 7,
        preferredDaysPerWeek: 7,
      }),
    ).toBeNull();
    expect(
      validateSchedulingParams({
        dayCapHours: 1,
        nightPriority: 0,
        eveningPriority: 0,
        repeatStartPenalty: 0,
        minRestHours: 4,
        preferredRestHours: 4,
        maxConsecutiveDays: 1,
        maxDaysPerWeek: 1,
        preferredDaysPerWeek: 1,
      }),
    ).toBeNull();
  });

  it("rejects a repeat start penalty outside 0 to 100 or fractional", () => {
    for (const repeatStartPenalty of [-1, 101, 0.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, repeatStartPenalty });
      expect(msg).toMatch(/Repeat start penalty/);
      expect(msg).not.toMatch(/—/);
    }
  });

  it("rejects minimum rest hours outside 4 to 16 or fractional", () => {
    for (const minRestHours of [3, 17, 8.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, minRestHours });
      expect(msg).toMatch(/Minimum rest hours/);
    }
  });

  it("rejects preferred rest hours outside 4 to 16 or fractional", () => {
    for (const preferredRestHours of [3, 17, 10.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, preferredRestHours });
      expect(msg).toMatch(/Preferred rest hours/);
    }
  });

  it("rejects max consecutive days outside 1 to 14 or fractional", () => {
    for (const maxConsecutiveDays of [0, 15, 5.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, maxConsecutiveDays });
      expect(msg).toMatch(/Max consecutive days/);
    }
  });

  it("rejects max days per week outside 1 to 7 or fractional", () => {
    for (const maxDaysPerWeek of [0, 8, 6.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, maxDaysPerWeek });
      expect(msg).toMatch(/Max days per week/);
    }
  });

  it("rejects preferred days per week outside 1 to 7 or fractional", () => {
    for (const preferredDaysPerWeek of [0, 8, 5.5]) {
      const msg = validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, preferredDaysPerWeek });
      expect(msg).toMatch(/Preferred days per week/);
    }
  });

  it("keeps preferred rest at or above minimum rest, from either side", () => {
    expect(
      validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, preferredRestHours: 7 }),
    ).toMatch(/Preferred rest hours/);
    expect(validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, minRestHours: 12 })).toMatch(
      /Preferred rest hours/,
    );
    expect(
      validateSchedulingParams({
        ...DEFAULT_SCHEDULING_PARAMS,
        minRestHours: 10,
        preferredRestHours: 10,
      }),
    ).toBeNull();
  });

  it("keeps preferred days at or below max days, from either side", () => {
    expect(
      validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, preferredDaysPerWeek: 7 }),
    ).toMatch(/Preferred days per week/);
    expect(validateSchedulingParams({ ...DEFAULT_SCHEDULING_PARAMS, maxDaysPerWeek: 4 })).toMatch(
      /Preferred days per week/,
    );
    expect(
      validateSchedulingParams({
        ...DEFAULT_SCHEDULING_PARAMS,
        maxDaysPerWeek: 5,
        preferredDaysPerWeek: 5,
      }),
    ).toBeNull();
  });
});

describe("storedSchedulingParams", () => {
  it("fills a partial value from the defaults", () => {
    expect(storedSchedulingParams(undefined)).toEqual(DEFAULT_SCHEDULING_PARAMS);
    expect(storedSchedulingParams({})).toEqual(DEFAULT_SCHEDULING_PARAMS);
    expect(storedSchedulingParams({ dayCapHours: 6, minRestHours: 9 })).toEqual({
      ...DEFAULT_SCHEDULING_PARAMS,
      dayCapHours: 6,
      minRestHours: 9,
    });
  });

  it("drops the whole value when any field is out of range", () => {
    expect(storedSchedulingParams({ dayCapHours: 99, nightPriority: 80 })).toEqual(
      DEFAULT_SCHEDULING_PARAMS,
    );
  });

  it("drops the whole value when a cross-field rule fails", () => {
    expect(storedSchedulingParams({ minRestHours: 12, preferredRestHours: 4 })).toEqual(
      DEFAULT_SCHEDULING_PARAMS,
    );
    expect(storedSchedulingParams({ maxDaysPerWeek: 3, preferredDaysPerWeek: 6 })).toEqual(
      DEFAULT_SCHEDULING_PARAMS,
    );
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
      ...DEFAULT_SCHEDULING_PARAMS,
      dayCapHours: 6,
    });
  });

  it("backfills a pre-overhaul stored value with the labor defaults", () => {
    const stored = '{"dayCapHours": 6, "nightPriority": 80, "eveningPriority": 10}';
    expect(parseSchedulingParams(stored)).toEqual({
      ...DEFAULT_SCHEDULING_PARAMS,
      dayCapHours: 6,
      nightPriority: 80,
      eveningPriority: 10,
    });
  });

  it("round-trips a full valid value", () => {
    const params = {
      dayCapHours: 10,
      nightPriority: 80,
      eveningPriority: 10,
      repeatStartPenalty: 30,
      minRestHours: 9,
      preferredRestHours: 11,
      maxConsecutiveDays: 6,
      maxDaysPerWeek: 5,
      preferredDaysPerWeek: 4,
    };
    expect(parseSchedulingParams(JSON.stringify(params))).toEqual(params);
  });
});
