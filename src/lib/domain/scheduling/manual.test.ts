import { describe, expect, it } from "vitest";
import type { ShiftBlock } from "../types";
import { laborLimits } from "./labor";
import {
  findDayConflict,
  laborWarningsForEdit,
  manualWeekendCohort,
  weekMinutesForEdit,
  type ExistingAssignment,
} from "./manual";
import { DEFAULT_SCHEDULING_PARAMS } from "./params";

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

  it("reports a day whose stored rows already break the rule, not the new shift", () => {
    // Nested pair predates the edit (block times changed under a live run);
    // even a disjoint candidate refuses, blaming the stored redundancy.
    const broken = [
      row("outer", "mon", "weekday", 14 * 60, 20 * 60),
      row("nested", "mon", "weekday", 16 * 60, 18 * 60),
    ];
    const hit = findDayConflict(block("am", 8 * 60, 10 * 60), "mon", broken);
    expect(hit).toMatchObject({ kind: "day-invalid", row: { blockId: "nested" } });
  });

  it("names the same redundant shift no matter the row order given", () => {
    const swallow = block("allday", 8 * 60, 12 * 60);
    const early = row("early", "mon", "weekday", 8 * 60, 9 * 60);
    const late = row("late", "mon", "weekday", 11 * 60, 12 * 60);
    const forward = findDayConflict(swallow, "mon", [early, late]);
    const reversed = findDayConflict(swallow, "mon", [late, early]);
    expect(forward).toMatchObject({ kind: "existing-covered", row: { blockId: "early" } });
    expect(reversed).toEqual(forward);
  });
});

describe("laborWarningsForEdit", () => {
  const limits = laborLimits(DEFAULT_SCHEDULING_PARAMS);

  it("returns nothing for a clean week", () => {
    const existing = [row("morning", "mon", "weekday", 8 * 60, 12 * 60)];
    const edit = { block: block("pm", 12 * 60, 16 * 60), day: "wed" as const };
    expect(laborWarningsForEdit(edit, "weekday", existing, limits)).toEqual([]);
  });

  it("describes a clopen the new shift would create", () => {
    const existing = [row("night", "mon", "weekday", 18 * 60, 23 * 60 + 30)];
    const edit = { block: block("open", 7 * 60, 11 * 60), day: "tue" as const };
    expect(laborWarningsForEdit(edit, "weekday", existing, limits)).toEqual([
      "Only 7h 30m of rest between Mon ending 11:30p and Tue starting 7a.",
    ]);
  });

  it("skips a student whose weekend rows mix cohorts", () => {
    // A Sat close in rotation a against a Sun open in rotation b would read as
    // a clopen under either single rotation, but the mixed pattern is outside
    // labor.ts's one-cohort scope; the read-time validator owns it.
    const existing = [
      row("sat-close", "sat", "a", 18 * 60, 23 * 60 + 30),
      row("sun-open", "sun", "b", 7 * 60, 11 * 60),
    ];
    const edit = { block: block("pm", 12 * 60, 16 * 60), day: "wed" as const };
    expect(laborWarningsForEdit(edit, "weekday", existing, limits)).toEqual([]);
  });
});

// What the caller's over-cap warning is judged on. It has to be the report's
// own arithmetic, or a warning and the read-time over-max flag could disagree
// about the very same week.
describe("weekMinutesForEdit", () => {
  const weekendBlock = (id: string, start: number, end: number): ShiftBlock => ({
    id,
    positionId: "p",
    dayType: "weekend",
    start,
    end,
  });

  it("counts weekday rows and the candidate whole", () => {
    const existing = [
      row("mon", "mon", "weekday", 8 * 60, 16 * 60),
      row("tue", "tue", "weekday", 8 * 60, 16 * 60),
    ];
    const edit = { block: block("wed", 8 * 60, 16 * 60), day: "wed" as const };
    expect(weekMinutesForEdit(edit, existing, false)).toBe(3 * 8 * 60);
  });

  it("halves a weekend candidate under A/B and counts it whole under every", () => {
    const existing = [row("mon", "mon", "weekday", 8 * 60, 16 * 60)];
    const edit = { block: weekendBlock("sat", 9 * 60, 17 * 60), day: "sat" as const };
    expect(weekMinutesForEdit(edit, existing, false)).toBe(480 + 240);
    expect(weekMinutesForEdit(edit, existing, true)).toBe(480 + 480);
  });

  it("counts a staggered same-day double once over its merged span", () => {
    // 8a-12p plus 11a-3p is one 7h clock-in, not 8h of two shifts.
    const existing = [row("am", "mon", "weekday", 8 * 60, 12 * 60)];
    const edit = { block: block("mid", 11 * 60, 15 * 60), day: "mon" as const };
    expect(weekMinutesForEdit(edit, existing, false)).toBe(7 * 60);
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
