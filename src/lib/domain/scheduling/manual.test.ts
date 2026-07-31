import { describe, expect, it } from "vitest";
import type { ShiftBlock } from "../types";
import { findDayOverlap, manualWeekendCohort, type ExistingAssignment } from "./manual";

const block = (id: string, start: number, end: number): ShiftBlock => ({
  id,
  positionId: "p",
  dayType: "weekday",
  start,
  end,
});

const row = (
  blockId: string,
  day: ExistingAssignment["day"],
  cohort: ExistingAssignment["cohort"],
  start: number,
  end: number,
): ExistingAssignment => ({ blockId, day, cohort, start, end });

describe("findDayOverlap", () => {
  const existing = [row("morning", "mon", "weekday", 8 * 60, 12 * 60)];

  it("refuses a true same-day overlap", () => {
    const hit = findDayOverlap(block("mid", 11 * 60, 15 * 60), "mon", existing);
    expect(hit?.blockId).toBe("morning");
  });

  it("allows touching shifts (end meets start)", () => {
    expect(findDayOverlap(block("noon", 12 * 60, 16 * 60), "mon", existing)).toBeNull();
  });

  it("ignores other days", () => {
    expect(findDayOverlap(block("mid", 11 * 60, 15 * 60), "tue", existing)).toBeNull();
  });

  it("ignores the block's own row (idempotent re-set)", () => {
    const own = [row("morning", "mon", "weekday", 8 * 60, 12 * 60)];
    expect(findDayOverlap(block("morning", 8 * 60, 12 * 60), "mon", own)).toBeNull();
  });
});

describe("manualWeekendCohort", () => {
  it("reuses the rotation of an existing weekend row", () => {
    const existing = [
      row("wd", "mon", "weekday", 8 * 60, 12 * 60),
      row("we", "sat", "b", 9 * 60, 13 * 60),
    ];
    expect(manualWeekendCohort(existing, false)).toBe("b");
    // The existing rotation wins even over the opt-in.
    expect(manualWeekendCohort(existing, true)).toBe("b");
  });

  it("uses 'every' for an every-weekend opt-in with no weekend rows yet", () => {
    const existing = [row("wd", "mon", "weekday", 8 * 60, 12 * 60)];
    expect(manualWeekendCohort(existing, true)).toBe("every");
  });

  it("defaults to 'a' otherwise", () => {
    expect(manualWeekendCohort([], false)).toBe("a");
  });
});
