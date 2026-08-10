/**
 * Returner-first ordering: experienced staff pick before new hires, and FCFS
 * still decides everything inside each cohort.
 *
 * The point of the ordering is to spread experience across shifts without a
 * per-cell "N experienced" constraint, which could not be guaranteed anyway.
 * These tests pin the two halves of that claim: returners really do outrank
 * earlier-submitting new hires, and among equals the earlier response still
 * wins.
 */
import { describe, expect, it } from "vitest";

import { parseTime } from "../time";
import type { Position, SelectedShift, ShiftBlock } from "../types";
import { generateAssignments } from "./engine";
import type { EngineInput, ScheduleStudent } from "./types";

const CA: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};

// One scarce cell: capacity 1, so exactly one person can hold it and the
// ordering alone decides who. It is also the evening block, because the engine
// ranks cells by unmet share of target plus an evening bonus; if the roomy
// block were the later one it would outrank the scarce one and nobody would
// ever compete for the cell under test.
const SCARCE = "ca-scarce";
const BLOCKS: ShiftBlock[] = [
  {
    id: SCARCE,
    positionId: "ca",
    dayType: "weekday",
    start: parseTime("1:00p"),
    end: parseTime("6:00p"),
    desiredCapacity: 1,
  },
  {
    id: "ca-spare",
    positionId: "ca",
    dayType: "weekday",
    start: parseTime("8:00a"),
    end: parseTime("1:00p"),
    desiredCapacity: 9,
  },
];

const at = (n: number) => new Date(Date.UTC(2026, 7, 1, 10, n));

function student(
  email: string,
  order: number,
  returner: boolean,
  selection: SelectedShift[],
): ScheduleStudent {
  return {
    email,
    positionId: "ca",
    international: false,
    everyWeekendOptIn: false,
    desiredHours: 10,
    submittedAt: at(order),
    scheduled: false,
    returner,
    selection,
  };
}

const wants = (blockId: string): SelectedShift[] =>
  (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ blockId, day }));

const both = [...wants(SCARCE), ...wants("ca-spare")];

function run(students: ScheduleStudent[]) {
  const input: EngineInput = { students, positions: [CA], blocks: BLOCKS, previous: [] };
  return generateAssignments(input);
}

/** Who holds the capacity-1 cell on Monday. */
const holderOfScarce = (result: ReturnType<typeof run>) =>
  result.assignments.find((a) => a.blockId === SCARCE && a.day === "mon")?.studentEmail ?? null;

describe("returner-first ordering", () => {
  it("places a returner ahead of a new hire who submitted earlier", () => {
    const result = run([
      student("new@wisc.edu", 1, false, both),
      student("returner@wisc.edu", 99, true, both),
    ]);
    expect(holderOfScarce(result)).toBe("returner@wisc.edu");
  });

  it("keeps FCFS inside the returner cohort", () => {
    const result = run([
      student("late-returner@wisc.edu", 50, true, both),
      student("early-returner@wisc.edu", 2, true, both),
    ]);
    expect(holderOfScarce(result)).toBe("early-returner@wisc.edu");
  });

  it("keeps FCFS inside the new-hire cohort", () => {
    const result = run([
      student("late-new@wisc.edu", 50, false, both),
      student("early-new@wisc.edu", 2, false, both),
    ]);
    expect(holderOfScarce(result)).toBe("early-new@wisc.edu");
  });

  it("falls back to pure FCFS when nobody is flagged a returner", () => {
    const result = run([
      student("b@wisc.edu", 9, false, both),
      student("a@wisc.edu", 1, false, both),
    ]);
    expect(holderOfScarce(result)).toBe("a@wisc.edu");
  });

  it("is deterministic: same inputs, same holder, whatever the input order", () => {
    const a = student("one@wisc.edu", 5, true, both);
    const b = student("two@wisc.edu", 5, true, both);
    expect(holderOfScarce(run([a, b]))).toBe(holderOfScarce(run([b, a])));
  });

  it("treats an absent returner flag as a new hire", () => {
    const unflagged: ScheduleStudent = { ...student("x@wisc.edu", 1, false, both) };
    delete (unflagged as { returner?: boolean }).returner;
    const result = run([unflagged, student("r@wisc.edu", 80, true, both)]);
    expect(holderOfScarce(result)).toBe("r@wisc.edu");
  });
});
