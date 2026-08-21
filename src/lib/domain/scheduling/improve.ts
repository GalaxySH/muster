/**
 * Improvement pass (docs/schedule-generation-plan.md §3.4): bounded, same-day
 * relocation. FCFS guarantees each student their hour quantity; this pass may
 * shuffle WHICH of their own selected cells they hold, pulling seats out of
 * untargeted or well-covered cells into needier, later-weighted ones.
 *
 * A move happens when the destination's pull (unmet share of target plus the
 * tunable tier bonus) beats the hole the seat would leave behind, evaluated
 * with the seat lifted out of the ledger. Invariants: a relocation stays
 * within the student's selections and the same day (so the min-days
 * concentration and the daily cap survive), never lowers the student's covered
 * hours, never carries them past their own weekly hour cap (../caps.ts, hard
 * since 1.15), keeps every shift on the day contributing unique time, never
 * touches a student marked scheduled, and obeys the labor rules (./labor.ts) as a
 * COUNT-PRESERVING diff rather than an absolute bar: a move may never add a
 * net-new hard violation nor raise the soft count, but a week that already
 * carries hard violations (only ever from carried state) may keep them. The
 * labor check only FILTERS moves, it never scores them,
 * so the termination argument is untouched. Deterministic
 * first-improvement order with a fixed round cap; each move strictly raises
 * the weighted-coverage objective, so the pass always terminates.
 */
import { demandCellKey } from "../demand";
import { coveredMinutes, redundantRangeIndex } from "../intervals";
import { EPSILON_MINUTES, type TimeRange } from "../time";
import type { Day, ShiftBlock } from "../types";
import { laborLimits, laborViolations, type LaborLimits } from "./labor";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "./params";
import { isOverMaxHours } from "./problems";
import {
  DAY_INDEX,
  SeatLedger,
  averagedAssignedMinutes,
  byEmail,
  byHashedEmail,
  tierBonus,
} from "./seats";
import {
  weekendCohortOf,
  type Cohort,
  type ScheduleAssignment,
  type ScheduleStudent,
} from "./types";

const MAX_ROUNDS = 3;
const MIN_GAIN = 1e-9;

export interface ImproveResult {
  assignments: ScheduleAssignment[];
  moved: number;
  /** Seat counts for the rows as they ended up, for any later placement pass. */
  ledger: SeatLedger;
}

export function improveAssignments(
  assignments: readonly ScheduleAssignment[],
  students: readonly ScheduleStudent[],
  blocks: readonly ShiftBlock[],
  params: SchedulingParams = DEFAULT_SCHEDULING_PARAMS,
  deferred: ReadonlySet<string> = new Set(),
): ImproveResult {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const studentByEmail = new Map(students.map((s) => [s.email, s]));
  const dayCapMinutes = params.dayCapHours * 60;
  const limits = laborLimits(params);

  const ledger = new SeatLedger();
  const rows = assignments.map((a) => ({ ...a }));
  for (const row of rows) ledger.add(row.blockId, row.day, row.cohort);

  const takenByStudent = new Map<string, Set<string>>();
  const rowsByStudent = new Map<string, typeof rows>();
  for (const row of rows) {
    let taken = takenByStudent.get(row.studentEmail);
    if (!taken) {
      taken = new Set();
      takenByStudent.set(row.studentEmail, taken);
    }
    taken.add(demandCellKey(row.blockId, row.day));
    const list = rowsByStudent.get(row.studentEmail) ?? [];
    list.push(row);
    rowsByStudent.set(row.studentEmail, list);
  }

  /** One student's full-day coverage, rebuilt for a day whenever a move lands there. */
  const studentDayRanges = (email: string, day: Day): TimeRange[] => {
    const ranges: TimeRange[] = [];
    for (const r of rowsByStudent.get(email) ?? []) {
      if (r.day !== day) continue;
      const b = blockById.get(r.blockId);
      if (b) ranges.push({ start: b.start, end: b.end });
    }
    return ranges;
  };
  // Labor bookkeeping only for students the pass may move; frozen students'
  // rows stay in rowsByStudent for seat accounting but are never judged.
  const rangesByStudent = new Map<string, Map<Day, TimeRange[]>>();
  for (const [email, list] of rowsByStudent) {
    if (studentByEmail.get(email)?.scheduled) continue;
    const byDay = new Map<Day, TimeRange[]>();
    for (const r of list) {
      if (!byDay.has(r.day)) byDay.set(r.day, studentDayRanges(email, r.day));
    }
    rangesByStudent.set(email, byDay);
  }
  // The labor rules read one weekend rotation for the whole map: the rotation
  // their rows are on (./types.ts), else "every" for opt-ins, else null
  // (weekday-only, where the rotation cannot matter).
  const cohortByStudent = new Map<string, Cohort | null>();
  for (const [email, list] of rowsByStudent) {
    if (studentByEmail.get(email)?.scheduled) continue;
    cohortByStudent.set(
      email,
      weekendCohortOf(list) ?? (studentByEmail.get(email)?.everyWeekendOptIn ? "every" : null),
    );
  }

  const ordered = [...rows].sort(
    (a, b) =>
      byHashedEmail(a.studentEmail, b.studentEmail) ||
      DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)! ||
      byEmail(a.blockId, b.blockId),
  );

  let moved = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let movedThisRound = false;
    for (const row of ordered) {
      const student = studentByEmail.get(row.studentEmail);
      if (!student || student.scheduled) continue;
      const from = blockById.get(row.blockId);
      if (!from) continue;

      // Lift the seat out so both sides see the state a move would create:
      // the hole it leaves in its own cell, untouched counts everywhere else.
      ledger.remove(row.blockId, row.day, row.cohort);
      const vacated =
        from.desiredCapacity == null
          ? 0
          : ledger.need(from, row.day, row.cohort) + tierBonus(from, params);

      const target = bestRelocation(row, from, student, blockById, ledger, params, deferred, {
        taken: takenByStudent.get(row.studentEmail)!,
        siblings: rowsByStudent.get(row.studentEmail)!,
        dayCapMinutes,
        vacated,
        limits,
        ranges: rangesByStudent.get(row.studentEmail)!,
        cohort: cohortByStudent.get(row.studentEmail) ?? null,
      });
      if (!target) {
        ledger.add(row.blockId, row.day, row.cohort);
        continue;
      }

      ledger.add(target.id, row.day, row.cohort);
      const taken = takenByStudent.get(row.studentEmail)!;
      taken.delete(demandCellKey(row.blockId, row.day));
      taken.add(demandCellKey(target.id, row.day));
      row.blockId = target.id;
      rangesByStudent
        .get(row.studentEmail)!
        .set(row.day, studentDayRanges(row.studentEmail, row.day));
      moved += 1;
      movedThisRound = true;
    }
    if (!movedThisRound) break;
  }

  return { assignments: rows, moved, ledger };
}

/**
 * The best same-day cell this row could move to for a strict gain over the
 * vacated cell's pull, or null. Untargeted destinations never gain (they claim
 * no need), and deferred cells are never a destination: relocation is an
 * optimization, never what lets a student reach their minimums, so nothing may
 * move into one. A seat already sitting in a deferred cell is free to move out.
 * Candidates rank by pull, then block id.
 */
function bestRelocation(
  row: ScheduleAssignment,
  from: ShiftBlock,
  student: ScheduleStudent,
  blockById: Map<string, ShiftBlock>,
  ledger: SeatLedger,
  params: SchedulingParams,
  deferred: ReadonlySet<string>,
  state: {
    taken: Set<string>;
    siblings: { blockId: string; day: Day }[];
    dayCapMinutes: number;
    vacated: number;
    limits: LaborLimits;
    /** The student's full current coverage, day by day. */
    ranges: ReadonlyMap<Day, TimeRange[]>;
    cohort: Cohort | null;
  },
): ShiftBlock | null {
  const otherRanges: TimeRange[] = [];
  for (const sibling of state.siblings) {
    if (sibling.day !== row.day) continue;
    if (sibling.blockId === row.blockId) continue;
    const block = blockById.get(sibling.blockId);
    if (block) otherRanges.push({ start: block.start, end: block.end });
  }
  const oldAvg = dayMinutes(otherRanges, { start: from.start, end: from.end });
  // Current violation counts, computed once and only when some candidate gets
  // as far as the labor check (laborViolations builds detail strings, so it
  // stays off the path of cheaply rejected candidates).
  let current: { hard: number; soft: number } | null = null;

  let best: ShiftBlock | null = null;
  let bestPull = 0;
  for (const cell of student.selection) {
    if (cell.day !== row.day || cell.blockId === row.blockId) continue;
    if (deferred.has(cell.blockId)) continue;
    if (state.taken.has(demandCellKey(cell.blockId, cell.day))) continue;
    const block = blockById.get(cell.blockId);
    if (!block || block.positionId !== student.positionId) continue;
    if (block.dayType !== from.dayType) continue;
    if (block.desiredCapacity == null) continue;
    if (!ledger.fits(block, cell.day, row.cohort)) continue;

    const pull = ledger.need(block, cell.day, row.cohort) + tierBonus(block, params);
    if (pull <= state.vacated + MIN_GAIN) continue;

    const range: TimeRange = { start: block.start, end: block.end };
    // otherRanges already excludes the vacated row; every shift in the
    // resulting day set must keep at least one minute of unique coverage.
    if (redundantRangeIndex([...otherRanges, range]) >= 0) continue;
    if (otherRanges.length > 0 && dayMinutes(otherRanges, range) > state.dayCapMinutes) continue;
    if (dayMinutes(otherRanges, range) + EPSILON_MINUTES < oldAvg) continue;

    // Labor rules on the whole hypothetical week: other days unchanged, this
    // day's coverage becomes its other shifts plus the destination. A same-day
    // move shifts the day's first start and last end, which can create or cure
    // a clopen with adjacent days, so the check is a diff: a move may keep or
    // cure violations, never add net-new ones at either severity. Engine-built
    // rows are hard-clean, so the hard side only bites on carried state that
    // was never the engine's to begin with. (Frozen students' rows flow
    // through this pass's bookkeeping but are skipped for moving, so they are
    // never judged here; the read-time validator owns them.)
    const hypothetical = new Map(state.ranges);
    hypothetical.set(row.day, [...otherRanges, range]);

    // The student's weekly hour cap, hard since 1.15 (../caps.ts). A relocation
    // moves a row to a different block, so the minutes can change and this pass
    // could otherwise carry someone past a cap the engine respected. A plain
    // AFTER-check is enough here, unlike the count-preserving labor diff below:
    // engine output is already at or under the cap, so there is no pre-existing
    // violation this could be blamed for failing to preserve.
    if (
      isOverMaxHours(
        averagedAssignedMinutes(hypothetical, student.everyWeekendOptIn),
        student.international,
      )
    ) {
      continue;
    }

    const violations = laborViolations(hypothetical, state.cohort, state.limits);
    const hardAfter = violations.filter((v) => v.severity === "hard").length;
    current ??= countBySeverity(laborViolations(state.ranges, state.cohort, state.limits));
    if (hardAfter > current.hard) continue;
    if (violations.length - hardAfter > current.soft) continue;

    if (best === null || pull > bestPull || (pull === bestPull && block.id < best.id)) {
      best = block;
      bestPull = pull;
    }
  }
  return best;
}

/** Covered minutes of one day's spans; the cycle factor cancels out day-locally. */
function dayMinutes(others: readonly TimeRange[], candidate: TimeRange): number {
  return coveredMinutes([...others, candidate]);
}

/** Hard and soft counts of one violation list. */
function countBySeverity(violations: { severity: "hard" | "soft" }[]): {
  hard: number;
  soft: number;
} {
  const hard = violations.filter((v) => v.severity === "hard").length;
  return { hard, soft: violations.length - hard };
}
