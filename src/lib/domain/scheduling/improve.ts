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
 * hours, and never touches a student marked scheduled. Deterministic
 * first-improvement order with a fixed round cap; each move strictly raises
 * the weighted-coverage objective, so the pass always terminates.
 */
import { demandCellKey } from "../demand";
import { coveredMinutes } from "../intervals";
import { eitherContains, type TimeRange } from "../time";
import type { Day, ShiftBlock } from "../types";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "./params";
import { DAY_INDEX, EPSILON_MINUTES, SeatLedger, byEmail, tierBonus } from "./seats";
import type { ScheduleAssignment, ScheduleStudent } from "./types";

const MAX_ROUNDS = 3;
const MIN_GAIN = 1e-9;

export interface ImproveResult {
  assignments: ScheduleAssignment[];
  moved: number;
}

export function improveAssignments(
  assignments: readonly ScheduleAssignment[],
  students: readonly ScheduleStudent[],
  blocks: readonly ShiftBlock[],
  params: SchedulingParams = DEFAULT_SCHEDULING_PARAMS,
): ImproveResult {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const studentByEmail = new Map(students.map((s) => [s.email, s]));
  const dayCapMinutes = params.dayCapHours * 60;

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

  const ordered = [...rows].sort(
    (a, b) =>
      byEmail(a.studentEmail, b.studentEmail) ||
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

      const target = bestRelocation(row, from, student, blockById, ledger, params, {
        taken: takenByStudent.get(row.studentEmail)!,
        siblings: rowsByStudent.get(row.studentEmail)!,
        dayCapMinutes,
        vacated,
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
      moved += 1;
      movedThisRound = true;
    }
    if (!movedThisRound) break;
  }

  return { assignments: rows, moved };
}

/**
 * The best same-day cell this row could move to for a strict gain over the
 * vacated cell's pull, or null. Untargeted destinations never gain (they claim
 * no need). Candidates rank by pull, then block id.
 */
function bestRelocation(
  row: ScheduleAssignment,
  from: ShiftBlock,
  student: ScheduleStudent,
  blockById: Map<string, ShiftBlock>,
  ledger: SeatLedger,
  params: SchedulingParams,
  state: {
    taken: Set<string>;
    siblings: { blockId: string; day: Day }[];
    dayCapMinutes: number;
    vacated: number;
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

  let best: ShiftBlock | null = null;
  let bestPull = 0;
  for (const cell of student.selection) {
    if (cell.day !== row.day || cell.blockId === row.blockId) continue;
    if (state.taken.has(demandCellKey(cell.blockId, cell.day))) continue;
    const block = blockById.get(cell.blockId);
    if (!block || block.positionId !== student.positionId) continue;
    if (block.dayType !== from.dayType) continue;
    if (block.desiredCapacity == null) continue;
    if (!ledger.fits(block, cell.day, row.cohort)) continue;

    const pull = ledger.need(block, cell.day, row.cohort) + tierBonus(block, params);
    if (pull <= state.vacated + MIN_GAIN) continue;

    const range: TimeRange = { start: block.start, end: block.end };
    if (otherRanges.some((r) => eitherContains(r, range))) continue;
    if (otherRanges.length > 0 && dayMinutes(otherRanges, range) > state.dayCapMinutes) continue;
    if (dayMinutes(otherRanges, range) + EPSILON_MINUTES < oldAvg) continue;

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
