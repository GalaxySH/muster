import { describe, it, expect } from "vitest";
import { parseTime } from "./time";
import { computeCapacity, distinctSelectedDays } from "./capacity";
import type { ShiftBlock, SelectedShift } from "./types";

function wk(id: string, start: string, end: string): ShiftBlock {
  return { id, positionId: "ca", dayType: "weekday", start: parseTime(start), end: parseTime(end), highDemand: false };
}
function we(id: string, start: string, end: string): ShiftBlock {
  return { id, positionId: "ca", dayType: "weekend", start: parseTime(start), end: parseTime(end), highDemand: false };
}

// Culinary Assistant blocks (PLAN.md §6.3), a representative subset.
const blocks: ShiftBlock[] = [
  wk("wd-open", "6:30a", "10:15a"), // 225m
  wk("wd-mid", "12:30p", "2:30p"), // 120m
  we("we-open", "8:30a", "11a"), // 150m
  we("we-close", "7:45p", "11:30p"), // 225m
];

const sel = (blockId: string, day: SelectedShift["day"]): SelectedShift => ({ blockId, day });

describe("computeCapacity", () => {
  it("sums best per-day packing across weekdays", () => {
    const selection = [sel("wd-open", "mon"), sel("wd-open", "tue"), sel("wd-mid", "tue")];
    const c = computeCapacity(selection, blocks, { everyWeekendOptIn: false });
    // Mon: 225, Tue: 225 + 120 (disjoint) = 345 → 570m weekday, 0 weekend.
    expect(c.weekdayMinutes).toBe(570);
    expect(c.weekendMinutesRaw).toBe(0);
    expect(c.weeklyAverageMinutes).toBe(570);
  });

  it("halves summed weekend hours under A/B (both days count)", () => {
    const selection = [sel("we-open", "sat"), sel("we-close", "sun")];
    const c = computeCapacity(selection, blocks, { everyWeekendOptIn: false });
    expect(c.weekendMinutesRaw).toBe(150 + 225); // both weekend days summed
    expect(c.weeklyAverageMinutes).toBe(0.5 * (150 + 225));
  });

  it("counts weekend hours fully with the every-weekend opt-in", () => {
    const selection = [sel("we-open", "sat"), sel("we-close", "sun")];
    const c = computeCapacity(selection, blocks, { everyWeekendOptIn: true });
    expect(c.weeklyAverageMinutes).toBe(375);
  });

  it("combines weekday and weekend contributions", () => {
    const selection = [sel("wd-open", "mon"), sel("we-open", "sat")];
    const c = computeCapacity(selection, blocks, { everyWeekendOptIn: false });
    expect(c.weeklyAverageMinutes).toBe(225 + 0.5 * 150);
    expect(c.weeklyAverageHours).toBeCloseTo((225 + 75) / 60);
  });

  it("throws on a selection referencing an unknown block", () => {
    expect(() => computeCapacity([sel("nope", "mon")], blocks, { everyWeekendOptIn: false })).toThrow();
  });
});

describe("distinctSelectedDays", () => {
  it("counts distinct days touched by the selection", () => {
    const selection = [sel("wd-open", "mon"), sel("wd-mid", "mon"), sel("wd-open", "wed"), sel("we-open", "sat")];
    expect(distinctSelectedDays(selection)).toEqual(new Set(["mon", "wed", "sat"]));
  });
});
