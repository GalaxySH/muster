/**
 * Chained scoped runs: what survives when one position is re-solved and the
 * rest are not.
 *
 * These drive the real engine through the same transform `generateSchedule`
 * applies (`applyScopeFreeze`), because the whole scoping design rests on one
 * claim that is easy to break by accident: a scoped run must carry every
 * out-of-scope student forward untouched, and must not report them as having
 * left the roster.
 */
import { describe, expect, it } from "vitest";

import { parseTime } from "../time";
import type { Position, SelectedShift, ShiftBlock } from "../types";
import { generateAssignments } from "./engine";
import { applyScopeFreeze } from "./scope";
import type { EngineInput, ScheduleAssignment, ScheduleStudent } from "./types";

const CA: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};
const SL: Position = {
  id: "sl",
  name: "Shift Lead",
  minHours: 15,
  minDays: 3,
  weekendExempt: false,
};
const POSITIONS = [CA, SL];

const block = (
  id: string,
  positionId: string,
  start: string,
  end: string,
  dayType: "weekday" | "weekend" = "weekday",
): ShiftBlock => ({
  id,
  positionId,
  dayType,
  start: parseTime(start),
  end: parseTime(end),
  desiredCapacity: null,
});

// Each position gets its own blocks, which is the real shape: positions never
// share a shift block, so their students never compete for the same cell.
const BLOCKS = [
  block("ca-am", "ca", "8:00a", "1:00p"),
  block("ca-pm", "ca", "1:00p", "6:00p"),
  block("ca-wknd", "ca", "9:00a", "3:00p", "weekend"),
  block("sl-am", "sl", "7:00a", "1:00p"),
  block("sl-pm", "sl", "1:00p", "7:00p"),
  block("sl-wknd", "sl", "8:00a", "4:00p", "weekend"),
];

const sel = (blockId: string, day: SelectedShift["day"]): SelectedShift => ({ blockId, day });
const at = (n: number) => new Date(Date.UTC(2026, 7, 1, 10, n));

function student(
  email: string,
  positionId: string,
  selection: SelectedShift[],
  order: number,
): ScheduleStudent {
  return {
    email,
    positionId,
    international: false,
    everyWeekendOptIn: false,
    desiredHours: positionId === "sl" ? 15 : 10,
    submittedAt: at(order),
    scheduled: false,
    selection,
  };
}

const EVERY_DAY: SelectedShift["day"][] = ["mon", "tue", "wed", "thu", "fri"];

const leads = [1, 2].map((n) =>
  student(
    `sl${n}@wisc.edu`,
    "sl",
    [...EVERY_DAY.flatMap((d) => [sel("sl-am", d), sel("sl-pm", d)]), sel("sl-wknd", "sat")],
    n,
  ),
);
const cooks = [1, 2].map((n) =>
  student(
    `ca${n}@wisc.edu`,
    "ca",
    [...EVERY_DAY.flatMap((d) => [sel("ca-am", d), sel("ca-pm", d)]), sel("ca-wknd", "sun")],
    10 + n,
  ),
);
const ALL = [...leads, ...cooks];

function run(students: ScheduleStudent[], previous: ScheduleAssignment[] = []) {
  const input: EngineInput = { students, positions: POSITIONS, blocks: BLOCKS, previous };
  return generateAssignments(input);
}

const rowsFor = (result: ReturnType<typeof run>, emails: string[]) =>
  result.assignments.filter((a) => emails.includes(a.studentEmail));

const key = (a: ScheduleAssignment) => `${a.studentEmail}|${a.blockId}|${a.day}`;

describe("chained scoped runs", () => {
  it("run one, scoped to one position, schedules only that position", () => {
    const first = run(applyScopeFreeze(ALL, { positionIds: ["sl"] }));

    expect(rowsFor(first, ["sl1@wisc.edu", "sl2@wisc.edu"]).length).toBeGreaterThan(0);
    // Out-of-scope students are frozen with nothing to carry on the first run,
    // so a scoped first run really is a partial plan.
    expect(rowsFor(first, ["ca1@wisc.edu", "ca2@wisc.edu"])).toEqual([]);
  });

  it("carries the first slice forward verbatim when the next run scopes elsewhere", () => {
    const first = run(applyScopeFreeze(ALL, { positionIds: ["sl"] }));
    const leadRows = rowsFor(first, ["sl1@wisc.edu", "sl2@wisc.edu"]);

    // Nobody is marked scheduled between the runs: this is the whole question.
    expect(ALL.every((s) => !s.scheduled)).toBe(true);

    const second = run(applyScopeFreeze(ALL, { positionIds: ["ca"] }), first.assignments);

    expect(rowsFor(second, ["sl1@wisc.edu", "sl2@wisc.edu"]).map(key).sort()).toEqual(
      leadRows.map(key).sort(),
    );
    expect(rowsFor(second, ["ca1@wisc.edu", "ca2@wisc.edu"]).length).toBeGreaterThan(0);
  });

  it("never reports the carried slice as having left the roster", () => {
    const first = run(applyScopeFreeze(ALL, { positionIds: ["sl"] }));
    const second = run(applyScopeFreeze(ALL, { positionIds: ["ca"] }), first.assignments);

    expect(second.report.droppedStudents).toEqual([]);
    expect(second.report.students.map((s) => s.email).sort()).toEqual(
      ALL.map((s) => s.email).sort(),
    );
  });

  it("marks the carried slice frozen and the re-solved slice not", () => {
    const first = run(applyScopeFreeze(ALL, { positionIds: ["sl"] }));
    const second = run(applyScopeFreeze(ALL, { positionIds: ["ca"] }), first.assignments);
    const frozen = (email: string) => second.report.students.find((s) => s.email === email)!.frozen;

    expect(frozen("sl1@wisc.edu")).toBe(true);
    expect(frozen("ca1@wisc.edu")).toBe(false);
  });

  it("re-solves everyone once a later run is unscoped, which is where the slice is at risk", () => {
    const first = run(applyScopeFreeze(ALL, { positionIds: ["sl"] }));
    const unscoped = run(applyScopeFreeze(ALL, null), first.assignments);

    // Nobody is frozen any more, so the leads are back in play. That is the
    // behaviour the "mark them scheduled" workflow exists to prevent.
    expect(unscoped.report.students.every((s) => !s.frozen)).toBe(true);
    expect(rowsFor(unscoped, ["ca1@wisc.edu", "ca2@wisc.edu"]).length).toBeGreaterThan(0);
  });

  it("keeps a marked student frozen through a run scoped to their own position", () => {
    const first = run(applyScopeFreeze(ALL, { positionIds: ["sl"] }));
    const withMarkedLead = ALL.map((s) =>
      s.email === "sl1@wisc.edu" ? { ...s, scheduled: true } : s,
    );
    const second = run(
      applyScopeFreeze(withMarkedLead, { positionIds: ["sl"] }),
      first.assignments,
    );

    expect(second.report.students.find((s) => s.email === "sl1@wisc.edu")!.frozen).toBe(true);
    expect(rowsFor(second, ["sl1@wisc.edu"]).map(key).sort()).toEqual(
      rowsFor(first, ["sl1@wisc.edu"]).map(key).sort(),
    );
  });
});
