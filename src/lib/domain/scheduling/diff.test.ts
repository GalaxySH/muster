import { describe, expect, it } from "vitest";
import type { Day } from "../types";
import type { Cohort, AssignmentSource, StudentScheduleReport } from "./types";
import {
  diffRuns,
  frozenSelectionMismatches,
  stalenessMessage,
  type RunCell,
  type RunSide,
} from "./diff";

const cell = (
  studentEmail: string,
  blockId: string,
  day: Day,
  cohort: Cohort = "weekday",
  source: AssignmentSource = "engine",
): RunCell => ({ studentEmail, blockId, day, cohort, source });

const report = (
  email: string,
  over: Partial<StudentScheduleReport> = {},
): StudentScheduleReport => ({
  email,
  targetMinutes: 600,
  assignedMinutes: 600,
  daysUsed: 2,
  cohort: null,
  frozen: false,
  ...over,
});

const side = (assignments: RunCell[], students: StudentScheduleReport[] = []): RunSide => ({
  assignments,
  students,
});

describe("diffRuns", () => {
  it("reports no differences between identical runs", () => {
    const rows = [cell("a@w", "b1", "mon"), cell("a@w", "b2", "sat", "a")];
    const d = diffRuns(side(rows, [report("a@w")]), side(rows, [report("a@w")]));
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.moved).toBe(0);
    expect(d.unchanged).toBe(1);
    expect(d.students).toEqual([]);
  });

  it("classifies added, removed, and rotation-moved cells", () => {
    const before = side(
      [cell("a@w", "b1", "mon"), cell("a@w", "b2", "sat", "a")],
      [report("a@w", { cohort: "a" })],
    );
    const after = side(
      [cell("a@w", "b2", "sat", "b"), cell("a@w", "b3", "tue")],
      [report("a@w", { cohort: "b" })],
    );
    const d = diffRuns(before, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.moved).toBe(1);
    expect(d.unchanged).toBe(0);
    expect(d.students).toHaveLength(1);
    const changes = d.students[0]!.changes;
    expect(changes).toEqual([
      { blockId: "b1", day: "mon", kind: "removed", cohort: "weekday", source: "engine" },
      { blockId: "b3", day: "tue", kind: "added", cohort: "weekday", source: "engine" },
      { blockId: "b2", day: "sat", kind: "moved", cohort: "b", fromCohort: "a", source: "engine" },
    ]);
  });

  it("keeps the source of a manual cell on both sides of the diff", () => {
    const d = diffRuns(
      side([cell("a@w", "b1", "mon", "weekday", "manual")]),
      side([cell("a@w", "b2", "mon", "weekday", "manual")]),
    );
    expect(d.students[0]!.changes.every((c) => c.source === "manual")).toBe(true);
  });

  it("lists a student who appears in only one run even with no cells", () => {
    const d = diffRuns(side([], [report("gone@w")]), side([], [report("new@w")]));
    expect(d.students.map((s) => s.email)).toEqual(["gone@w", "new@w"]);
    expect(d.students[0]!.before).not.toBeNull();
    expect(d.students[0]!.after).toBeNull();
    expect(d.students[1]!.before).toBeNull();
    expect(d.students[1]!.after).not.toBeNull();
  });

  it("carries both runs' report rows for the roll-up deltas", () => {
    const d = diffRuns(
      side([cell("a@w", "b1", "mon")], [report("a@w", { assignedMinutes: 480, daysUsed: 2 })]),
      side([cell("a@w", "b2", "mon")], [report("a@w", { assignedMinutes: 720, daysUsed: 3 })]),
    );
    const s = d.students[0]!;
    expect(s.before?.assignedMinutes).toBe(480);
    expect(s.after?.assignedMinutes).toBe(720);
    expect(s.after?.daysUsed).toBe(3);
  });

  it("orders students by email and changes in Sunday-start day order", () => {
    const d = diffRuns(
      side([]),
      side([
        cell("z@w", "b1", "mon"),
        cell("a@w", "b1", "sat", "a"),
        cell("a@w", "b1", "sun", "a"),
        cell("a@w", "b1", "mon"),
      ]),
    );
    expect(d.students.map((s) => s.email)).toEqual(["a@w", "z@w"]);
    expect(d.students[0]!.changes.map((c) => c.day)).toEqual(["sun", "mon", "sat"]);
  });
});

describe("frozenSelectionMismatches", () => {
  const selections = new Map([
    ["a@w", [{ blockId: "b1", day: "mon" as Day }]],
    ["b@w", [{ blockId: "b9", day: "sat" as Day }]],
  ]);

  it("reports a frozen student's kept cells outside their current picks", () => {
    const out = frozenSelectionMismatches(
      [cell("a@w", "b1", "mon"), cell("a@w", "b2", "tue")],
      new Set(["a@w"]),
      selections,
    );
    expect(out).toEqual([{ email: "a@w", cells: [{ blockId: "b2", day: "tue" }] }]);
  });

  it("ignores non-frozen students entirely", () => {
    const out = frozenSelectionMismatches([cell("b@w", "b2", "tue")], new Set(["a@w"]), selections);
    expect(out).toEqual([]);
  });

  it("counts an auto-assigned weekend cell as a selection when included", () => {
    // The loader passes ALL selection cells, machine-picked weekend included;
    // a kept row matching one is not a mismatch.
    const withAuto = new Map([["a@w", [{ blockId: "wk1", day: "sat" as Day }]]]);
    const out = frozenSelectionMismatches(
      [cell("a@w", "wk1", "sat", "a")],
      new Set(["a@w"]),
      withAuto,
    );
    expect(out).toEqual([]);
  });

  it("sorts students by email and cells by day then block", () => {
    const out = frozenSelectionMismatches(
      [cell("z@w", "b1", "fri"), cell("a@w", "b2", "sat", "a"), cell("a@w", "b1", "sun", "a")],
      new Set(["a@w", "z@w"]),
      new Map(),
    );
    expect(out.map((m) => m.email)).toEqual(["a@w", "z@w"]);
    expect(out[0]!.cells).toEqual([
      { blockId: "b1", day: "sun" },
      { blockId: "b2", day: "sat" },
    ]);
  });
});

describe("stalenessMessage", () => {
  it("is null when nothing changed since the run", () => {
    expect(stalenessMessage(0, 0)).toBeNull();
  });

  it("names both counts when submissions and edits both happened", () => {
    expect(stalenessMessage(4, 2)).toBe(
      "4 new submissions and 2 edited since this schedule was generated.",
    );
  });

  it("names only new submissions when nothing was edited", () => {
    expect(stalenessMessage(1, 0)).toBe("1 new submission since this schedule was generated.");
  });

  it("names only edits when nothing new arrived", () => {
    expect(stalenessMessage(0, 1)).toBe("1 response edited since this schedule was generated.");
    expect(stalenessMessage(0, 3)).toBe("3 responses edited since this schedule was generated.");
  });
});
