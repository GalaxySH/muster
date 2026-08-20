import { describe, expect, it } from "vitest";
import type { DayType, ShiftBlock } from "../types";
import { laborLimits } from "./labor";
import {
  dayConflictMessage,
  findDayConflict,
  laborWarningsForRows,
  manualWeekendCohort,
  planScheduleEdits,
  weekMinutesForRows,
  type ExistingAssignment,
  type ScheduleEditPlan,
} from "./manual";
import { DEFAULT_SCHEDULING_PARAMS } from "./params";

const block = (
  id: string,
  start: number,
  end: number,
  dayType: DayType = "weekday",
): ShiftBlock => ({
  id,
  positionId: "p",
  dayType,
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

describe("dayConflictMessage", () => {
  const existing = [row("morning", "mon", "weekday", 8 * 60, 12 * 60)];

  // One composition for both callers: the grid blocks the click with the same
  // sentence the save would have refused with.
  it("says the candidate adds nothing", () => {
    const inner = block("inner", 9 * 60, 11 * 60);
    const clash = findDayConflict(inner, "mon", existing)!;
    expect(dayConflictMessage(inner, "mon", clash)).toBe(
      "Their Mon shifts already cover 9a to 11a.",
    );
  });

  it("names the existing shift a new one would leave redundant", () => {
    const big = block("big", 7 * 60, 13 * 60);
    const clash = findDayConflict(big, "mon", existing)!;
    expect(dayConflictMessage(big, "mon", clash)).toBe(
      "That would leave their Mon 8a to 12p shift covering nothing new. Remove that one first.",
    );
  });

  it("blames the stored rows when the day was already broken", () => {
    const broken = [
      row("outer", "mon", "weekday", 14 * 60, 20 * 60),
      row("nested", "mon", "weekday", 16 * 60, 18 * 60),
    ];
    const am = block("am", 8 * 60, 10 * 60);
    const clash = findDayConflict(am, "mon", broken)!;
    expect(dayConflictMessage(am, "mon", clash)).toBe(
      "Their Mon 4p to 6p shift already covers nothing new. Remove that one first.",
    );
  });
});

// The grid saves a batch, so the warnings describe the state it lands on
// rather than each click along the way.
describe("laborWarningsForRows", () => {
  const limits = laborLimits(DEFAULT_SCHEDULING_PARAMS);

  it("returns nothing for a clean week", () => {
    const rows = [
      row("morning", "mon", "weekday", 8 * 60, 12 * 60),
      row("pm", "wed", "weekday", 12 * 60, 16 * 60),
    ];
    expect(laborWarningsForRows(rows, limits)).toEqual([]);
  });

  it("describes a clopen the rows come to", () => {
    const rows = [
      row("night", "mon", "weekday", 18 * 60, 23 * 60 + 30),
      row("open", "tue", "weekday", 7 * 60, 11 * 60),
    ];
    expect(laborWarningsForRows(rows, limits)).toEqual([
      "Only 7h 30m of rest between Mon ending 11:30p and Tue starting 7a.",
    ]);
  });

  it("judges the final state, so a batch that drops the offender is clean", () => {
    // The Mon night close is gone by the time the batch lands, so the Tue open
    // it used to clash with is no longer worth a word.
    const rows = [row("open", "tue", "weekday", 7 * 60, 11 * 60)];
    expect(laborWarningsForRows(rows, limits)).toEqual([]);
  });

  it("skips a student whose weekend rows mix cohorts", () => {
    // A Sat close in rotation a against a Sun open in rotation b would read as
    // a clopen under either single rotation, but the mixed pattern is outside
    // labor.ts's one-cohort scope; the read-time validator owns it.
    const rows = [
      row("sat-close", "sat", "a", 18 * 60, 23 * 60 + 30),
      row("sun-open", "sun", "b", 7 * 60, 11 * 60),
    ];
    expect(laborWarningsForRows(rows, limits)).toEqual([]);
  });
});

// What the caller's over-cap warning is judged on. It has to be the report's
// own arithmetic, or a warning and the read-time over-max flag could disagree
// about the very same week.
describe("weekMinutesForRows", () => {
  it("counts weekday rows whole", () => {
    const rows = [
      row("mon", "mon", "weekday", 8 * 60, 16 * 60),
      row("tue", "tue", "weekday", 8 * 60, 16 * 60),
      row("wed", "wed", "weekday", 8 * 60, 16 * 60),
    ];
    expect(weekMinutesForRows(rows, false)).toBe(3 * 8 * 60);
  });

  it("halves a weekend row under A/B and counts it whole under every", () => {
    const rows = [
      row("mon", "mon", "weekday", 8 * 60, 16 * 60),
      row("sat", "sat", "a", 9 * 60, 17 * 60),
    ];
    expect(weekMinutesForRows(rows, false)).toBe(480 + 240);
    expect(weekMinutesForRows(rows, true)).toBe(480 + 480);
  });

  it("counts a staggered same-day double once over its merged span", () => {
    // 8a-12p plus 11a-3p is one 7h clock-in, not 8h of two shifts.
    const rows = [
      row("am", "mon", "weekday", 8 * 60, 12 * 60),
      row("mid", "mon", "weekday", 11 * 60, 15 * 60),
    ];
    expect(weekMinutesForRows(rows, false)).toBe(7 * 60);
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

// The batch decision the save action executes, with no database under it: what
// lands, in what order, and which cell a refusal blames.
describe("planScheduleEdits", () => {
  const morning = block("morning", 8 * 60, 12 * 60);
  const inner = block("inner", 9 * 60, 11 * 60);
  const allday = block("allday", 7 * 60, 18 * 60);
  const early = block("early", 8 * 60, 9 * 60);
  const dawn = block("dawn", 6 * 60, 9 * 60);
  const afternoon = block("afternoon", 13 * 60, 17 * 60);
  const satShift = block("sat-shift", 9 * 60, 13 * 60, "weekend");
  const sunShift = block("sun-shift", 10 * 60, 14 * 60, "weekend");

  const ctx = (blocks: ShiftBlock[], everyWeekendOptIn = false) => ({
    blocks: new Map(blocks.map((b) => [b.id, b])),
    everyWeekendOptIn,
  });

  /** Narrow to an applied plan; a refusal fails the test carrying its sentence. */
  function applied(plan: ScheduleEditPlan) {
    if (!plan.ok) throw new Error(`unexpected refusal: ${plan.error}`);
    return plan;
  }

  it("passes the removes through and orders the inserts by calendar day", () => {
    const plan = applied(
      planScheduleEdits(
        [row("morning", "mon", "weekday", 8 * 60, 12 * 60)],
        [{ blockId: "morning", day: "mon" }],
        // Deliberately out of order: Wed before Tue, late block before early.
        [
          { blockId: "afternoon", day: "wed" },
          { blockId: "morning", day: "wed" },
          { blockId: "morning", day: "tue" },
        ],
        ctx([morning, afternoon]),
      ),
    );
    expect(plan.removes).toEqual([{ blockId: "morning", day: "mon" }]);
    expect(plan.inserts).toEqual([
      { blockId: "morning", day: "tue", cohort: "weekday" },
      { blockId: "morning", day: "wed", cohort: "weekday" },
      { blockId: "afternoon", day: "wed", cohort: "weekday" },
    ]);
    // The rows the batch lands on: the Mon removal is gone, the three adds are
    // in, and this is what the caller's warnings get judged against.
    expect(plan.rows.map((r) => `${r.day}:${r.blockId}`)).toEqual([
      "tue:morning",
      "wed:morning",
      "wed:afternoon",
    ]);
  });

  it("applies the calendar-earlier of two clashing adds and blames the later one", () => {
    // Neither cell exists yet, so the only thing 9a-11a clashes with is its own
    // batch-mate: the 8a-12p add ordered ahead of it.
    const plan = planScheduleEdits(
      [],
      [],
      [
        { blockId: "inner", day: "mon" },
        { blockId: "morning", day: "mon" },
      ],
      ctx([morning, inner]),
    );
    expect(plan).toEqual({
      ok: false,
      error: "Mon 9a to 11a: Their Mon shifts already cover 9a to 11a.",
    });
  });

  it("names the same cell whatever order the grid sent the adds in", () => {
    const cells = [
      { blockId: "allday", day: "tue" as const },
      { blockId: "early", day: "tue" as const },
    ];
    const forward = planScheduleEdits([], [], cells, ctx([allday, early]));
    const reversed = planScheduleEdits([], [], [...cells].reverse(), ctx([allday, early]));
    // 7a-6p sorts first, so the 8a-9a cell is the one left covering nothing.
    expect(forward).toEqual({
      ok: false,
      error: "Tue 8a to 9a: Their Tue shifts already cover 8a to 9a.",
    });
    expect(reversed).toEqual(forward);
  });

  it("lets a removal in the same batch make room for an add", () => {
    // 9a-11a sits inside the 8a-12p row they hold, so it is only legal because
    // the same batch takes that row out first.
    const plan = applied(
      planScheduleEdits(
        [row("morning", "mon", "weekday", 8 * 60, 12 * 60)],
        [{ blockId: "morning", day: "mon" }],
        [{ blockId: "inner", day: "mon" }],
        ctx([morning, inner]),
      ),
    );
    expect(plan.inserts).toEqual([{ blockId: "inner", day: "mon", cohort: "weekday" }]);
  });

  it("refuses all of a batch, not the part it got through", () => {
    const plan = planScheduleEdits(
      [row("morning", "mon", "weekday", 8 * 60, 12 * 60)],
      [],
      [
        { blockId: "dawn", day: "mon" }, // legal, and judged first (6a)
        { blockId: "inner", day: "mon" }, // swallowed by the Mon row they hold
      ],
      ctx([dawn, inner]),
    );
    // toEqual, not toMatchObject: a refusal carries no operations at all, so
    // there is nothing for a caller to half-apply.
    expect(plan).toEqual({
      ok: false,
      error: "Mon 9a to 11a: Their Mon shifts already cover 9a to 11a.",
    });
  });

  it("skips a cell they already hold instead of clashing it with itself", () => {
    const plan = applied(
      planScheduleEdits(
        [row("morning", "mon", "weekday", 8 * 60, 12 * 60)],
        [],
        [{ blockId: "morning", day: "mon" }],
        ctx([morning]),
      ),
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });

  it("refuses a cell whose shift is no longer live, naming the day", () => {
    // Retired blocks are left out of the map the caller loads, so a trial built
    // before the retirement refuses rather than resurrecting the shift.
    const plan = planScheduleEdits([], [], [{ blockId: "retired", day: "mon" }], ctx([morning]));
    expect(plan).toEqual({ ok: false, error: "Mon: That shift no longer exists." });
  });

  it("refuses a weekday shift dropped on a weekend day", () => {
    const plan = planScheduleEdits([], [], [{ blockId: "morning", day: "sat" }], ctx([morning]));
    expect(plan).toEqual({
      ok: false,
      error: "Sat 8a to 12p: That shift does not run on Sat.",
    });
  });

  it("derives the weekend cohort from the rows the batch has left, not the ones it found", () => {
    // Their one weekend row (rotation b) goes out in the same batch, so it no
    // longer fixes anything: the adds fall to the opt-in's "every", and the Sun
    // one then fixes the rotation the Sat one follows. A batch can never leave
    // a student holding two rotations at once.
    const plan = applied(
      planScheduleEdits(
        [row("old-sat", "sat", "b", 9 * 60, 13 * 60)],
        [{ blockId: "old-sat", day: "sat" }],
        [
          { blockId: "sat-shift", day: "sat" },
          { blockId: "sun-shift", day: "sun" },
        ],
        ctx([satShift, sunShift], true),
      ),
    );
    // Sun opens the scheduling week (PLAN §7), so it is judged first.
    expect(plan.inserts).toEqual([
      { blockId: "sun-shift", day: "sun", cohort: "every" },
      { blockId: "sat-shift", day: "sat", cohort: "every" },
    ]);
  });

  it("reuses the rotation of a weekend row the batch keeps", () => {
    const plan = applied(
      planScheduleEdits(
        [row("old-sat", "sat", "b", 9 * 60, 13 * 60)],
        [],
        [{ blockId: "sun-shift", day: "sun" }],
        // Even against an every-weekend opt-in: the row they already hold decides.
        ctx([sunShift], true),
      ),
    );
    expect(plan.inserts).toEqual([{ blockId: "sun-shift", day: "sun", cohort: "b" }]);
  });
});
