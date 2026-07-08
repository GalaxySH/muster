import { describe, it, expect } from "vitest";
import { parseTime } from "./time";
import { checkDesiredHours, validateAvailability } from "./validation";
import type { ShiftBlock, Position, SelectedShift } from "./types";

function b(id: string, dt: "weekday" | "weekend", start: string, end: string): ShiftBlock {
  return {
    id,
    positionId: "ca",
    dayType: dt,
    start: parseTime(start),
    end: parseTime(end),
  };
}

// Culinary Assistant blocks (PLAN.md §6.3).
const CA_BLOCKS: ShiftBlock[] = [
  b("wd-open", "weekday", "6:30a", "10:15a"), // 225
  b("wd-2", "weekday", "10a", "12:45p"), // 165
  b("wd-mid", "weekday", "12:30p", "2:30p"), // 120
  b("wd-4", "weekday", "2:15p", "5p"), // 165
  b("wd-5", "weekday", "4:45p", "8p"), // 195
  b("wd-close", "weekday", "7:45p", "11:30p"), // 225
  b("we-open", "weekend", "8:30a", "11a"), // 150
  b("we-close", "weekend", "7:45p", "11:30p"), // 225
];

const CA: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};
const BARISTA: Position = {
  id: "barista",
  name: "Barista",
  minHours: 10,
  minDays: 2,
  weekendExempt: true,
};

const s = (blockId: string, day: SelectedShift["day"]): SelectedShift => ({ blockId, day });
const ids = (checks: { id: string; passed: boolean }[]) =>
  checks.filter((c) => !c.passed).map((c) => c.id);

describe("validateAvailability", () => {
  it("passes a complete selection with no flags", () => {
    const selection = [
      s("wd-open", "mon"),
      s("wd-open", "tue"),
      s("wd-open", "wed"),
      s("we-open", "sat"),
    ];
    const r = validateAvailability(selection, CA, CA_BLOCKS, { everyWeekendOptIn: false });
    expect(r.canSubmit).toBe(true);
    expect(r.flags).toEqual([]);
    expect(r.daysCovered).toBe(4);
  });

  it("hard-blocks when capacity is below the hours floor", () => {
    const selection = [s("wd-open", "mon"), s("wd-close", "tue")]; // 450m < 600m
    const r = validateAvailability(selection, CA, CA_BLOCKS, { everyWeekendOptIn: false });
    expect(r.canSubmit).toBe(false);
    expect(ids(r.checks)).toContain("min_hours");
  });

  it("hard-blocks when neither an open nor a close block is selected", () => {
    const selection = [s("wd-2", "mon"), s("wd-mid", "tue"), s("wd-4", "wed"), s("wd-5", "thu")];
    const r = validateAvailability(selection, CA, CA_BLOCKS, { everyWeekendOptIn: false });
    expect(ids(r.checks)).toContain("open_or_close");
    expect(r.canSubmit).toBe(false);
  });

  it("hard-blocks when the selection spans too few days", () => {
    // open+mid+close pack to 570m in one day (8h floor cleared) but the
    // selection only spans a single day, so the 2-day rule still blocks.
    const lowFloor: Position = { ...CA, minHours: 8 };
    const selection = [s("wd-open", "mon"), s("wd-mid", "mon"), s("wd-close", "mon")];
    const r = validateAvailability(selection, lowFloor, CA_BLOCKS, { everyWeekendOptIn: false });
    expect(ids(r.checks)).toContain("min_days");
    expect(ids(r.checks)).not.toContain("min_hours");
    expect(r.canSubmit).toBe(false);
  });

  it("raises a soft flag (not a block) when no weekend shift is selected", () => {
    const selection = [s("wd-open", "mon"), s("wd-open", "tue"), s("wd-open", "wed")];
    const r = validateAvailability(selection, CA, CA_BLOCKS, { everyWeekendOptIn: false });
    expect(r.canSubmit).toBe(true);
    expect(r.flags.map((f) => f.type)).toContain("auto_assigned_weekend");
  });

  it("exempts Barista from the weekend rule entirely", () => {
    const selection = [s("wd-open", "mon"), s("wd-open", "tue"), s("wd-open", "wed")];
    const r = validateAvailability(selection, BARISTA, CA_BLOCKS, { everyWeekendOptIn: false });
    expect(r.flags).toEqual([]);
    expect(r.checks.map((c) => c.id)).not.toContain("weekend");
  });

  it("respects a higher Shift-Lead day floor", () => {
    const SL: Position = { ...CA, id: "sl", minHours: 10, minDays: 3 };
    const selection = [s("wd-open", "mon"), s("wd-open", "tue"), s("we-open", "sat")]; // 2 weekdays + 1 weekend
    const r = validateAvailability(selection, SL, CA_BLOCKS, { everyWeekendOptIn: false });
    expect(r.daysCovered).toBe(3);
    expect(ids(r.checks)).not.toContain("min_days");
  });
});

describe("checkDesiredHours", () => {
  it("fails when no value is entered", () => {
    const c = checkDesiredHours(null, CA);
    expect(c.passed).toBe(false);
    expect(c.severity).toBe("hard");
    expect(c.detail).toMatch(/enter your desired weekly hours/i);
  });

  it("fails when the value is not a finite number", () => {
    expect(checkDesiredHours(Number.NaN, CA).passed).toBe(false);
    expect(checkDesiredHours(Number.POSITIVE_INFINITY, CA).passed).toBe(false);
  });

  it("fails below the position minimum and names the floor", () => {
    const c = checkDesiredHours(5, CA);
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("10h");
  });

  it("passes at exactly the position minimum", () => {
    expect(checkDesiredHours(10, CA).passed).toBe(true);
  });

  it("passes above the minimum (the cap is never enforced at entry)", () => {
    expect(checkDesiredHours(40, CA).passed).toBe(true);
  });

  it("uses the position's own floor (Shift Lead 15h)", () => {
    const SL: Position = { ...CA, id: "sl", minHours: 15, minDays: 3 };
    expect(checkDesiredHours(12, SL).passed).toBe(false);
    expect(checkDesiredHours(12, SL).detail).toContain("15h");
    expect(checkDesiredHours(15, SL).passed).toBe(true);
  });
});
