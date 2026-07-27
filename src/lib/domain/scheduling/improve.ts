/**
 * Improvement pass (docs/schedule-generation-plan.md §3.4): bounded, same-day
 * relocation. FCFS guarantees each student their hour quantity; this pass may
 * shuffle WHICH of their own selected cells they hold, pulling seats out of
 * untargeted or low-tier cells into scarcer, later-ending ones.
 *
 * Invariants: a relocation stays within the student's selections and the same
 * day (so the min-days concentration and the daily cap survive), never lowers
 * the student's covered hours, and never touches a student marked scheduled.
 * Deterministic first-improvement order with a fixed round cap.
 */
import { demandCellKey } from "../demand";
import { coveredMinutes } from "../intervals";
import { overlaps, type TimeRange } from "../time";
import type { Day, ShiftBlock } from "../types";
import {
  DAY_CAP_MINUTES,
  DAY_INDEX,
  EPSILON_MINUTES,
  SeatLedger,
  byEmail,
  seatScore,
} from "./seats";
import type { ScheduleAssignment, ScheduleStudent } from "./types";

const MAX_ROUNDS = 3;

export interface ImproveResult {
  assignments: ScheduleAssignment[];
  moved: number;
}

export function improveAssignments(
  assignments: readonly ScheduleAssignment[],
  students: readonly ScheduleStudent[],
  blocks: readonly ShiftBlock[],
): ImproveResult {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const studentByEmail = new Map(students.map((s) => [s.email, s]));

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

      const target = bestRelocation(row, from, student, blockById, ledger, {
        taken: takenByStudent.get(row.studentEmail)!,
        siblings: rowsByStudent.get(row.studentEmail)!,
      });
      if (!target) continue;

      ledger.remove(row.blockId, row.day, row.cohort);
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
 * The best same-day cell this row could move to for a strict objective gain,
 * or null. Candidates are ranked by score gain, then shortfall, then block id.
 */
function bestRelocation(
  row: ScheduleAssignment,
  from: ShiftBlock,
  student: ScheduleStudent,
  blockById: Map<string, ShiftBlock>,
  ledger: SeatLedger,
  state: { taken: Set<string>; siblings: { blockId: string; day: Day }[] },
): ShiftBlock | null {
  const fromScore = seatScore(from);
  const otherRanges: TimeRange[] = [];
  for (const sibling of state.siblings) {
    if (sibling.day !== row.day) continue;
    if (sibling.blockId === row.blockId) continue;
    const block = blockById.get(sibling.blockId);
    if (block) otherRanges.push({ start: block.start, end: block.end });
  }
  const dayRanges = (extra: TimeRange) => [...otherRanges, extra];
  const oldAvg = dayMinutes(otherRanges, { start: from.start, end: from.end });

  let best: ShiftBlock | null = null;
  let bestGain = 0;
  let bestShortfall = 0;
  for (const cell of student.selection) {
    if (cell.day !== row.day || cell.blockId === row.blockId) continue;
    if (state.taken.has(demandCellKey(cell.blockId, cell.day))) continue;
    const block = blockById.get(cell.blockId);
    if (!block || block.positionId !== student.positionId) continue;
    if (block.dayType !== from.dayType) continue;
    if (!ledger.fits(block, cell.day, row.cohort)) continue;

    const range: TimeRange = { start: block.start, end: block.end };
    if (otherRanges.some((r) => overlaps(r, range))) continue;
    if (otherRanges.length > 0 && coveredMinutes(dayRanges(range)) > DAY_CAP_MINUTES) continue;
    if (dayMinutes(otherRanges, range) + EPSILON_MINUTES < oldAvg) continue;

    const gain = seatScore(block) - fromScore;
    if (gain <= 0) continue;
    const shortfall = ledger.shortfall(block, cell.day, row.cohort);
    if (
      best === null ||
      gain > bestGain ||
      (gain === bestGain &&
        (shortfall > bestShortfall || (shortfall === bestShortfall && block.id < best.id)))
    ) {
      best = block;
      bestGain = gain;
      bestShortfall = shortfall;
    }
  }
  return best;
}

/** Covered minutes of one day's spans; the cycle factor cancels out day-locally. */
function dayMinutes(others: readonly TimeRange[], candidate: TimeRange): number {
  return coveredMinutes([...others, candidate]);
}
