import { describe, expect, it } from "vitest";
import type { ShiftBlock } from "../types";
import { findDayConflict, manualWeekendCohort, type ExistingAssignment } from "./manual";

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

  it("reports a block whose whole span the existing shift already covers", () => {
    expect(findDayConflict(block("inner", 9 * 60, 11 * 60), "mon", existing)).toEqual({
      kind: "candidate-covered",
    });
  });

  it("reports the existing shift a swallowing block would leave redundant", () => {
    const hit = findDayConflict(block("big", 7 * 60, 13 * 60), "mon", existing);
    expect(hit).toMatchObject({ kind: "existing-covered", row: { blockId: "morning" } });
  });

  it("treats identical times as already covered", () => {
    expect(findDayConflict(block("twin", 8 * 60, 12 * 60), "mon", existing)).toEqual({
      kind: "candidate-covered",
    });
  });

  it("refuses a block covered only by the union of a staggered double", () => {
    const double = [
      row("first", "mon", "weekday", 12 * 60, 15 * 60),
      row("second", "mon", "weekday", 14 * 60 + 45, 18 * 60),
    ];
    expect(findDayConflict(block("mid", 13 * 60, 17 * 60), "mon", double)).toEqual({
      kind: "candidate-covered",
    });
  });

  it("refuses a block whose arrival leaves an existing shift covered by the union", () => {
    const pair = [
      row("first", "mon", "weekday", 12 * 60, 15 * 60),
      row("mid", "mon", "weekday", 13 * 60, 17 * 60),
    ];
    const hit = findDayConflict(block("late", 14 * 60 + 45, 18 * 60), "mon", pair);
    expect(hit).toMatchObject({ kind: "existing-covered", row: { blockId: "mid" } });
  });

  it("allows a block between two disjoint shifts (coverage is a set, not a hull)", () => {
    const bookends = [
      row("am", "mon", "weekday", 8 * 60, 10 * 60),
      row("pm", "mon", "weekday", 16 * 60, 18 * 60),
    ];
    expect(findDayConflict(block("mid", 12 * 60, 14 * 60), "mon", bookends)).toBeNull();
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
