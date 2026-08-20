import { describe, it, expect } from "vitest";
import { parseTime } from "../time";
import { coveredMinutes } from "../intervals";
import { assignedCellCount } from "../coverage";
import {
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  dayTypeOf,
  type Day,
  type Position,
  type SelectedShift,
  type ShiftBlock,
} from "../types";
import { annealAssignments } from "./anneal";
import { generateAssignments } from "./engine";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "./params";
import { averagedAssignedMinutes, targetMinutes } from "./seats";
import { validateRunLabor, type ValidatorRow } from "./validate";
import type { Cohort, ScheduleAssignment, ScheduleStudent } from "./types";

const CA: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};
const BAR: Position = { id: "bar", name: "Barista", minHours: 4, minDays: 1, weekendExempt: true };
const POSITIONS = [CA, BAR];

function block(
  id: string,
  positionId: string,
  dayType: "weekday" | "weekend",
  start: string,
  end: string,
  desiredCapacity: number | null = null,
): ShiftBlock {
  return { id, positionId, dayType, start: parseTime(start), end: parseTime(end), desiredCapacity };
}

const sel = (blockId: string, day: Day): SelectedShift => ({ blockId, day });
const at = (n: number) => new Date(Date.UTC(2026, 7, 1, 10, n));

function student(email: string, over: Partial<ScheduleStudent> = {}): ScheduleStudent {
  return {
    email,
    positionId: "ca",
    international: false,
    everyWeekendOptIn: false,
    desiredHours: 10,
    submittedAt: at(0),
    scheduled: false,
    selection: [],
    ...over,
  };
}

const withAnneal = (over: Partial<SchedulingParams> = {}): SchedulingParams => ({
  ...DEFAULT_SCHEDULING_PARAMS,
  annealIterations: 20_000,
  annealSeed: 1,
  ...over,
});

/**
 * Graded targeted fill, restated here the way stats.ts reports `filledOfTarget`.
 * Deliberately a second derivation: it is what pins the pass's own objective to
 * the number the admin surfaces show.
 */
function filledOfTarget(
  assignments: readonly ScheduleAssignment[],
  blocks: readonly ShiftBlock[],
): number {
  const counts = new Map<string, { a: number; b: number }>();
  for (const row of assignments) {
    const key = `${row.blockId}|${row.day}`;
    const c = counts.get(key) ?? { a: 0, b: 0 };
    if (row.cohort === "b") c.b += 1;
    else if (row.cohort === "every") {
      c.a += 1;
      c.b += 1;
    } else c.a += 1;
    counts.set(key, c);
  }
  let total = 0;
  for (const b of blocks) {
    if (b.desiredCapacity == null) continue;
    for (const day of b.dayType === "weekend" ? WEEKEND_DAYS : WEEKDAY_DAYS) {
      total += Math.min(
        assignedCellCount(b.dayType, counts.get(`${b.id}|${day}`)),
        b.desiredCapacity,
      );
    }
  }
  return total;
}

function rangesFor(
  assignments: readonly ScheduleAssignment[],
  blocks: readonly ShiftBlock[],
  email: string,
): Map<Day, { start: number; end: number }[]> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const ranges = new Map<Day, { start: number; end: number }[]>();
  for (const row of assignments) {
    if (row.studentEmail !== email) continue;
    const b = byId.get(row.blockId)!;
    const list = ranges.get(row.day) ?? [];
    list.push({ start: b.start, end: b.end });
    ranges.set(row.day, list);
  }
  return ranges;
}

const minutesFor = (
  assignments: readonly ScheduleAssignment[],
  blocks: readonly ShiftBlock[],
  s: ScheduleStudent,
) => averagedAssignedMinutes(rangesFor(assignments, blocks, s.email), s.everyWeekendOptIn);

/** Every violation the INDEPENDENT read-time validator finds in these rows. */
function validate(assignments: readonly ScheduleAssignment[], blocks: readonly ShiftBlock[]) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const rows: ValidatorRow[] = assignments.map((a) => {
    const b = byId.get(a.blockId)!;
    return {
      studentEmail: a.studentEmail,
      blockId: a.blockId,
      day: a.day,
      cohort: a.cohort,
      start: b.start,
      end: b.end,
      source: "engine" as const,
      frozen: false,
    };
  });
  const p = DEFAULT_SCHEDULING_PARAMS;
  const findings = validateRunLabor(rows, {
    dayCapMinutes: p.dayCapHours * 60,
    maxConsecutiveDays: p.maxConsecutiveDays,
    maxDaysPerWeek: p.maxDaysPerWeek,
    preferredDaysPerWeek: p.preferredDaysPerWeek,
    minRestMinutes: p.minRestHours * 60,
    preferredRestMinutes: p.preferredRestHours * 60,
  });
  let hard = 0;
  let soft = 0;
  for (const f of findings) {
    for (const v of f.violations) {
      if (v.severity === "hard") hard += 1;
      else soft += 1;
    }
  }
  return { hard, soft, findings };
}

// ---------------------------------------------------------------------------
// A population with real contention: more students than seats, varied picks.
// ---------------------------------------------------------------------------

const caBlocks = [
  block("ca-am", "ca", "weekday", "7a", "11a", 2),
  block("ca-mid", "ca", "weekday", "11a", "3p", 2),
  block("ca-pm", "ca", "weekday", "3p", "7p", 2),
  block("ca-night", "ca", "weekday", "6p", "10p", 2),
  block("ca-we-am", "ca", "weekend", "8a", "12p", 2),
  block("ca-we-pm", "ca", "weekend", "12p", "4p", 2),
];

/** Deterministic varied selections: each student takes a rotating slice. */
function population(count: number): ScheduleStudent[] {
  const weekdayBlocks = ["ca-am", "ca-mid", "ca-pm", "ca-night"];
  const out: ScheduleStudent[] = [];
  for (let i = 0; i < count; i++) {
    const selection: SelectedShift[] = [];
    for (let d = 0; d < WEEKDAY_DAYS.length; d++) {
      const day = WEEKDAY_DAYS[(i + d) % WEEKDAY_DAYS.length]!;
      selection.push(sel(weekdayBlocks[(i + d) % weekdayBlocks.length]!, day));
      selection.push(sel(weekdayBlocks[(i + d + 1) % weekdayBlocks.length]!, day));
    }
    selection.push(sel(i % 2 === 0 ? "ca-we-am" : "ca-we-pm", i % 3 === 0 ? "sat" : "sun"));
    out.push(
      student(`s${String(i).padStart(2, "0")}@w`, {
        submittedAt: at(i),
        desiredHours: 10 + (i % 8),
        selection,
      }),
    );
  }
  return out;
}

function seedRun(students: ScheduleStudent[], blocks: ShiftBlock[]) {
  return generateAssignments({
    students,
    positions: POSITIONS,
    blocks,
    previous: [],
    params: { ...DEFAULT_SCHEDULING_PARAMS, annealIterations: 0 },
  });
}

describe("annealAssignments: off by default", () => {
  it("returns the rows untouched when iterations is 0", () => {
    const students = population(12);
    const seed = seedRun(students, caBlocks);
    const result = annealAssignments(
      seed.assignments,
      students,
      POSITIONS,
      caBlocks,
      DEFAULT_SCHEDULING_PARAMS,
    );
    expect(DEFAULT_SCHEDULING_PARAMS.annealIterations).toBe(0);
    expect(result.assignments).toEqual(seed.assignments);
    expect(result.gainedSeats).toBe(0);
    expect(result.accepted).toBe(0);
  });
});

describe("annealAssignments: determinism", () => {
  it("reproduces byte-identical rows for the same seed", () => {
    const students = population(14);
    const seed = seedRun(students, caBlocks);
    const a = annealAssignments(seed.assignments, students, POSITIONS, caBlocks, withAnneal());
    const b = annealAssignments(seed.assignments, students, POSITIONS, caBlocks, withAnneal());
    expect(JSON.stringify(a.assignments)).toBe(JSON.stringify(b.assignments));
    expect(a.gainedSeats).toBe(b.gainedSeats);
    expect(a.accepted).toBe(b.accepted);
  });

  it("stays legal under a different seed, and never scores below the seed run", () => {
    const students = population(14);
    const seed = seedRun(students, caBlocks);
    for (const annealSeed of [1, 7, 99]) {
      const r = annealAssignments(
        seed.assignments,
        students,
        POSITIONS,
        caBlocks,
        withAnneal({ annealSeed }),
      );
      expect(r.gainedSeats).toBeGreaterThanOrEqual(0);
      expect(validate(r.assignments, caBlocks).hard).toBe(0);
    }
  });
});

describe("annealAssignments: the objective is the one stats.ts reports", () => {
  it("gainedSeats equals the change in graded targeted fill", () => {
    const students = population(16);
    const seed = seedRun(students, caBlocks);
    const before = filledOfTarget(seed.assignments, caBlocks);
    const r = annealAssignments(seed.assignments, students, POSITIONS, caBlocks, withAnneal());
    const after = filledOfTarget(r.assignments, caBlocks);
    expect(after - before).toBe(r.gainedSeats);
  });
});

describe("annealAssignments: it actually exchanges seats", () => {
  // Two cells of one seat each. Greedy gives the earlier responder the cell the
  // later one also needs, and the later one gets nothing. Only an exchange
  // fixes it: move the first to the cell nobody else wants, then seat the
  // second. Reordering cannot, because whoever goes second still finds it full.
  const blocks = [
    block("x", "bar", "weekday", "8a", "12p", 1),
    block("y", "bar", "weekday", "8a", "12p", 1),
  ];
  const first = student("early@w", {
    positionId: "bar",
    desiredHours: 4,
    submittedAt: at(0),
    selection: [sel("x", "mon"), sel("y", "tue")],
  });
  const second = student("late@w", {
    positionId: "bar",
    desiredHours: 4,
    submittedAt: at(5),
    selection: [sel("x", "mon")],
  });

  it("frees a contested seat and fills both cells", () => {
    const students = [first, second];
    const seed = seedRun(students, blocks);
    expect(filledOfTarget(seed.assignments, blocks)).toBe(1);

    const r = annealAssignments(seed.assignments, students, POSITIONS, blocks, withAnneal());
    expect(r.gainedSeats).toBe(1);
    expect(filledOfTarget(r.assignments, blocks)).toBe(2);
    // And the early responder still has their hours, inside their own picks.
    expect(minutesFor(r.assignments, blocks, first)).toBe(240);
    expect(minutesFor(r.assignments, blocks, second)).toBe(240);
  });
});

describe("annealAssignments: invariants hold over the whole population", () => {
  const students = population(18);
  const seed = seedRun(students, caBlocks);
  const result = annealAssignments(
    seed.assignments,
    students,
    POSITIONS,
    caBlocks,
    withAnneal({ annealIterations: 40_000 }),
  );

  it("adds no hard labor violation, and no soft one beyond the seed's", () => {
    const before = validate(seed.assignments, caBlocks);
    const after = validate(result.assignments, caBlocks);
    expect(after.hard).toBe(0);
    expect(before.hard).toBe(0);
    expect(after.soft).toBeLessThanOrEqual(before.soft);
  });

  it("only ever assigns cells the student selected", () => {
    for (const s of students) {
      const picks = new Set(s.selection.map((c) => `${c.blockId}|${c.day}`));
      for (const row of result.assignments.filter((a) => a.studentEmail === s.email)) {
        expect(picks.has(`${row.blockId}|${row.day}`)).toBe(true);
      }
    }
  });

  it("never drops a student below the hours the greedy pass secured them", () => {
    for (const s of students) {
      const position = POSITIONS.find((p) => p.id === s.positionId)!;
      const floor = Math.min(minutesFor(seed.assignments, caBlocks, s), targetMinutes(s, position));
      expect(minutesFor(result.assignments, caBlocks, s)).toBeGreaterThanOrEqual(floor - 1e-6);
    }
  });

  it("never drops a student below their day floor, and keeps a weekend day", () => {
    for (const s of students) {
      const position = POSITIONS.find((p) => p.id === s.positionId)!;
      const seedDays = rangesFor(seed.assignments, caBlocks, s.email).size;
      const floorDays = Math.min(seedDays, position.minDays);
      const after = rangesFor(result.assignments, caBlocks, s.email);
      expect(after.size).toBeGreaterThanOrEqual(floorDays);

      const hadWeekend = [...rangesFor(seed.assignments, caBlocks, s.email).keys()].some(
        (d) => dayTypeOf(d) === "weekend",
      );
      if (hadWeekend) {
        expect([...after.keys()].some((d) => dayTypeOf(d) === "weekend")).toBe(true);
      }
    }
  });

  it("keeps every student inside their own weekly hour cap", () => {
    for (const s of students) {
      expect(minutesFor(result.assignments, caBlocks, s)).toBeLessThanOrEqual(30 * 60 + 1e-6);
    }
  });

  it("keeps every day's shifts each contributing unique coverage", () => {
    for (const s of students) {
      for (const list of rangesFor(result.assignments, caBlocks, s.email).values()) {
        const total = coveredMinutes(list);
        for (let i = 0; i < list.length; i++) {
          const without = coveredMinutes(list.filter((_, j) => j !== i));
          expect(without).toBeLessThan(total);
        }
      }
    }
  });

  it("respects every cell's capacity, per rotation week", () => {
    const counts = new Map<string, { a: number; b: number }>();
    for (const row of result.assignments) {
      const key = `${row.blockId}|${row.day}`;
      const c = counts.get(key) ?? { a: 0, b: 0 };
      if (row.cohort === "b") c.b += 1;
      else if (row.cohort === "every") {
        c.a += 1;
        c.b += 1;
      } else c.a += 1;
      counts.set(key, c);
    }
    const byId = new Map(caBlocks.map((b) => [b.id, b]));
    for (const [key, c] of counts) {
      const cap = byId.get(key.split("|")[0]!)!.desiredCapacity;
      if (cap == null) continue;
      expect(c.a).toBeLessThanOrEqual(cap);
      expect(c.b).toBeLessThanOrEqual(cap);
    }
  });

  it("gives every student at most one row per cell", () => {
    const seen = new Set<string>();
    for (const row of result.assignments) {
      const key = `${row.studentEmail}|${row.blockId}|${row.day}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("keeps each student on one weekend rotation", () => {
    const byStudent = new Map<string, Set<Cohort>>();
    for (const row of result.assignments) {
      if (row.cohort === "weekday") continue;
      const set = byStudent.get(row.studentEmail) ?? new Set<Cohort>();
      set.add(row.cohort);
      byStudent.set(row.studentEmail, set);
    }
    for (const set of byStudent.values()) expect(set.size).toBe(1);
  });
});

describe("annealAssignments: who it may not touch", () => {
  it("carries frozen students' rows through verbatim", () => {
    const frozen = student("frozen@w", {
      scheduled: true,
      submittedAt: at(1),
      selection: [sel("ca-am", "mon"), sel("ca-mid", "tue")],
    });
    const others = population(8);
    const students = [frozen, ...others];
    const previous: ScheduleAssignment[] = [
      {
        studentEmail: "frozen@w",
        blockId: "ca-am",
        day: "mon",
        cohort: "weekday",
        source: "manual",
      },
    ];
    const seed = generateAssignments({
      students,
      positions: POSITIONS,
      blocks: caBlocks,
      previous,
      params: { ...DEFAULT_SCHEDULING_PARAMS, annealIterations: 0 },
    });
    const before = seed.assignments.filter((a) => a.studentEmail === "frozen@w");
    const r = annealAssignments(seed.assignments, students, POSITIONS, caBlocks, withAnneal());
    const after = r.assignments.filter((a) => a.studentEmail === "frozen@w");
    expect(after).toEqual(before);
    expect(after[0]!.source).toBe("manual");
  });

  it("leaves fill-in students out of the search entirely", () => {
    const fill = student("fill@w", {
      fillIn: true,
      submittedAt: null,
      selection: [sel("ca-am", "mon"), sel("ca-mid", "tue"), sel("ca-pm", "wed")],
    });
    const students = [...population(8), fill];
    // A fill-in row that exists before the pass must survive it unchanged; the
    // pass must never place, move, or remove one.
    const seeded: ScheduleAssignment[] = [
      { studentEmail: "fill@w", blockId: "ca-am", day: "mon", cohort: "weekday" },
    ];
    const seed = seedRun(students, caBlocks);
    const withFill = [...seed.assignments.filter((a) => a.studentEmail !== "fill@w"), ...seeded];
    const r = annealAssignments(withFill, students, POSITIONS, caBlocks, withAnneal());
    expect(r.assignments.filter((a) => a.studentEmail === "fill@w")).toEqual(seeded);
  });
});

describe("through generateAssignments", () => {
  const students = population(16);

  it("changes nothing at all while the rounds are 0", () => {
    const off = generateAssignments({
      students,
      positions: POSITIONS,
      blocks: caBlocks,
      previous: [],
      params: { ...DEFAULT_SCHEDULING_PARAMS, annealIterations: 0 },
    });
    // The shipped default is off, so this is also what production runs today.
    const shipped = generateAssignments({
      students,
      positions: POSITIONS,
      blocks: caBlocks,
      previous: [],
    });
    expect(JSON.stringify(off.assignments)).toBe(JSON.stringify(shipped.assignments));
    expect(off.report.anneal).toBeUndefined();
  });

  it("records the seed and rounds that produced the run", () => {
    const on = generateAssignments({
      students,
      positions: POSITIONS,
      blocks: caBlocks,
      previous: [],
      params: withAnneal({ annealSeed: 5 }),
    });
    expect(on.report.anneal).toEqual({
      seed: 5,
      iterations: 20_000,
      gainedSeats: expect.any(Number),
      trimmedStudents: expect.any(Number),
    });
    expect(on.report.anneal!.gainedSeats).toBeGreaterThanOrEqual(0);
  });

  it("reproduces the whole run, and never reports more shortfall than with it off", () => {
    const input = {
      students,
      positions: POSITIONS,
      blocks: caBlocks,
      previous: [],
      params: withAnneal(),
    };
    const a = generateAssignments(input);
    const b = generateAssignments(input);
    expect(JSON.stringify(a.assignments)).toBe(JSON.stringify(b.assignments));

    const off = generateAssignments({ ...input, params: { ...withAnneal(), annealIterations: 0 } });
    expect(a.report.shortOfTarget).toBeLessThanOrEqual(off.report.shortOfTarget);
    expect(a.report.belowMinHours!).toBeLessThanOrEqual(off.report.belowMinHours!);
    expect(filledOfTarget(a.assignments, caBlocks)).toBeGreaterThanOrEqual(
      filledOfTarget(off.assignments, caBlocks),
    );
  });
});

describe("annealAssignments: deferred cells", () => {
  const blocks = [
    block("keep", "bar", "weekday", "8a", "12p", 1),
    block("late", "bar", "weekday", "8a", "12p", 2),
  ];
  it("never moves a seat into a deferred cell", () => {
    const students = [
      student("a@w", {
        positionId: "bar",
        desiredHours: 4,
        submittedAt: at(0),
        selection: [sel("keep", "mon"), sel("late", "mon"), sel("late", "tue")],
      }),
      student("b@w", {
        positionId: "bar",
        desiredHours: 4,
        submittedAt: at(1),
        selection: [sel("keep", "mon"), sel("late", "wed")],
      }),
    ];
    const deferred = new Set(["late"]);
    const seed = generateAssignments({
      students,
      positions: POSITIONS,
      blocks,
      previous: [],
      params: { ...DEFAULT_SCHEDULING_PARAMS, annealIterations: 0 },
      deferredBlockIds: [...deferred],
    });
    const seedLate = seed.assignments.filter((a) => a.blockId === "late").length;
    const r = annealAssignments(
      seed.assignments,
      students,
      POSITIONS,
      blocks,
      withAnneal(),
      deferred,
    );
    const afterLate = r.assignments.filter((a) => a.blockId === "late").length;
    expect(afterLate).toBeLessThanOrEqual(seedLate);
  });
});

// ---------------------------------------------------------------------------
// Weekend rotations. Seeds are built by hand here rather than run through the
// engine, so each case pins one starting state exactly: a student off the
// weekend with no rotation, or one greedy already placed.
// ---------------------------------------------------------------------------

const row = (
  studentEmail: string,
  blockId: string,
  day: Day,
  cohort: Cohort = "weekday",
): ScheduleAssignment => ({ studentEmail, blockId, day, cohort });

describe("annealAssignments: students greedy left off the weekend", () => {
  // Both reached their hours on weekdays, so neither is on a weekend and
  // neither has a rotation. The weekend cell needs people on BOTH weeks to
  // score anything, since it is graded on its needier week: one student on the
  // A week leaves it at zero.
  const blocks = [
    block("wd", "ca", "weekday", "8a", "4p", 5),
    block("we", "ca", "weekend", "8a", "12p", 1),
  ];
  const picks = [sel("wd", "mon"), sel("wd", "tue"), sel("we", "sat")];
  const students = [
    student("a@w", { submittedAt: at(0), desiredHours: 10, selection: picks }),
    student("b@w", { submittedAt: at(1), desiredHours: 10, selection: picks }),
  ];
  const seed = students.flatMap((s) => [row(s.email, "wd", "mon"), row(s.email, "wd", "tue")]);
  const result = annealAssignments(seed, students, POSITIONS, blocks, withAnneal());
  const weekendRows = (rows: readonly ScheduleAssignment[]) =>
    rows.filter((r) => r.blockId === "we");

  it("puts them on the weekend at all, which no rotation would have allowed", () => {
    expect(weekendRows(seed)).toHaveLength(0);
    expect(weekendRows(result.assignments)).toHaveLength(2);
  });

  it("splits them across the two weeks, so the cell actually fills", () => {
    expect(new Set(weekendRows(result.assignments).map((r) => r.cohort))).toEqual(
      new Set<Cohort>(["a", "b"]),
    );
    expect(filledOfTarget(seed, blocks)).toBe(4);
    expect(filledOfTarget(result.assignments, blocks)).toBe(5);
    expect(result.gainedSeats).toBe(1);
  });

  it("adds no labor violation the independent validator can find", () => {
    expect(validate(result.assignments, blocks).hard).toBe(0);
  });

  it("carries the rotation it handed out into the run report", () => {
    const run = generateAssignments({
      students,
      positions: POSITIONS,
      blocks,
      previous: [],
      params: withAnneal(),
    });
    const rotated = run.report.students.filter((s) => s.cohort !== null);
    expect(rotated.map((s) => s.email).sort()).toEqual(["a@w", "b@w"]);
  });
});

describe("annealAssignments: rotations greedy already chose", () => {
  // Two students on the same week of a two-seat cell, so it grades zero and
  // moving either one to the other week would be worth a seat. The pass leaves
  // them alone: re-rotating a student greedy placed is deferred work
  // (docs/generator-anneal-plan.md section 8). This pins the boundary.
  const blocks = [
    block("wd", "ca", "weekday", "8a", "4p", 5),
    block("we", "ca", "weekend", "8a", "12p", 2),
  ];
  const picks = [sel("wd", "mon"), sel("wd", "tue"), sel("we", "sat")];
  const students = [
    student("a@w", { submittedAt: at(0), desiredHours: 10, selection: picks }),
    student("b@w", { submittedAt: at(1), desiredHours: 10, selection: picks }),
  ];
  const seed = students.flatMap((s) => [
    row(s.email, "wd", "mon"),
    row(s.email, "wd", "tue"),
    row(s.email, "we", "sat", "a"),
  ]);

  it("leaves both on the week they were placed on", () => {
    const result = annealAssignments(seed, students, POSITIONS, blocks, withAnneal());
    const cohorts = result.assignments.filter((r) => r.blockId === "we").map((r) => r.cohort);
    expect(cohorts).toEqual(["a", "a"]);
    expect(filledOfTarget(result.assignments, blocks)).toBe(filledOfTarget(seed, blocks));
  });
});
