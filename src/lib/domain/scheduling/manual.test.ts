import { describe, expect, it } from "vitest";
import type { ShiftBlock } from "../types";
import {
  conflictCovers,
  findDayConflict,
  manualWeekendCohort,
  type ExistingAssignment,
} from "./manual";

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

describe("findDayConflict", () => {
  const existing = [row("morning", "mon", "weekday", 8 * 60, 12 * 60)];

  it("allows a staggered same-day overlap (a double across the handoff)", () => {
    expect(findDayConflict(block("mid", 11 * 60, 15 * 60), "mon", existing)).toBeNull();
  });

  it("refuses a block sitting inside an existing shift", () => {
    const hit = findDayConflict(block("inner", 9 * 60, 11 * 60), "mon", existing);
    expect(hit?.blockId).toBe("morning");
  });

  it("refuses a block that swallows an existing shift", () => {
    const hit = findDayConflict(block("big", 7 * 60, 13 * 60), "mon", existing);
    expect(hit?.blockId).toBe("morning");
  });

  it("refuses containment sharing an endpoint", () => {
    const hit = findDayConflict(block("tail", 10 * 60, 12 * 60), "mon", existing);
    expect(hit?.blockId).toBe("morning");
  });

  it("allows touching shifts (end meets start)", () => {
    expect(findDayConflict(block("noon", 12 * 60, 16 * 60), "mon", existing)).toBeNull();
  });

  it("ignores other days", () => {
    expect(findDayConflict(block("inner", 9 * 60, 11 * 60), "tue", existing)).toBeNull();
  });

  it("ignores the block's own row (idempotent re-set)", () => {
    const own = [row("morning", "mon", "weekday", 8 * 60, 12 * 60)];
    expect(findDayConflict(block("morning", 8 * 60, 12 * 60), "mon", own)).toBeNull();
  });
});

describe("conflictCovers", () => {
  const morning = row("morning", "mon", "weekday", 8 * 60, 12 * 60);

  it("is true when the existing shift covers the new block", () => {
    expect(conflictCovers(morning, block("inner", 9 * 60, 11 * 60))).toBe(true);
  });

  it("is false when the new block swallows the existing shift", () => {
    expect(conflictCovers(morning, block("big", 7 * 60, 13 * 60))).toBe(false);
  });

  it("treats identical times as covered", () => {
    expect(conflictCovers(morning, block("twin", 8 * 60, 12 * 60))).toBe(true);
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
