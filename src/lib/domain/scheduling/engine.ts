/**
 * Recommended-schedule engine (docs/schedule-generation-plan.md §3).
 *
 * Deterministic greedy, first-come-first-serve by submittedAt: early responders
 * pick first, which is fair, easy to explain, and makes rerunning the engine
 * reproduce unchanged students' schedules (no randomness anywhere).
 *
 * Per student the engine concentrates work onto the fewest days: it seeds the
 * position's minimum day count (2, Shift Lead 3), then fills already-worked
 * days before opening another, never letting one day's merged span exceed
 * DAY_CAP_MINUTES. A day only gets opened past the minimum when the student's
 * target hours cannot fit otherwise. Within a day set, later-ending and
 * scarcer cells are preferred (the "short at night" priority, first-class in
 * the objective rather than faked with lowered morning capacities).
 *
 * Students marked scheduled are frozen: their previous run's rows are carried
 * forward verbatim (still consuming capacity) and no pass touches them. The
 * admin's "mark scheduled" toggle is the whole protection model; there is no
 * separate pin concept.
 */
import { hourCap } from "../caps";
import { demandCellKey } from "../demand";
import { coveredMinutes } from "../intervals";
import { overlaps, type TimeRange } from "../time";
import type { Day, Position, ShiftBlock } from "../types";
import { improveAssignments } from "./improve";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "./params";
import {
  DAY_INDEX,
  EPSILON_MINUTES,
  SeatLedger,
  averagedAssignedMinutes,
  byEmail,
  tierBonus,
} from "./seats";
import type {
  Cohort,
  EngineInput,
  EngineResult,
  ScheduleAssignment,
  ScheduleStudent,
  StudentScheduleReport,
} from "./types";

export { DAY_CAP_MINUTES } from "./seats";

/** The engine's per-student hour goal: desired hours clamped to floor and cap. */
export function targetMinutes(student: ScheduleStudent, position: Position): number {
  const desired = student.desiredHours ?? position.minHours;
  return Math.max(Math.min(desired, hourCap(student.international)), position.minHours) * 60;
}

const fcfsTime = (s: ScheduleStudent) =>
  s.submittedAt ? s.submittedAt.getTime() : Number.MAX_SAFE_INTEGER;

interface ActiveState {
  student: ScheduleStudent;
  position: Position;
  target: number;
  ranges: Map<Day, TimeRange[]>;
  /** demandCellKey of every cell already assigned to this student. */
  taken: Set<string>;
  cohort: Exclude<Cohort, "weekday"> | null;
  assignments: ScheduleAssignment[];
}

export function generateAssignments(input: EngineInput): EngineResult {
  const params = input.params ?? DEFAULT_SCHEDULING_PARAMS;
  const blockById = new Map(input.blocks.map((b) => [b.id, b]));
  const positionById = new Map(input.positions.map((p) => [p.id, p]));
  const ledger = new SeatLedger();
  const weekendMinutes = { a: 0, b: 0 };

  const fcfs = [...input.students].sort(
    (x, y) => fcfsTime(x) - fcfsTime(y) || byEmail(x.email, y.email),
  );
  const eligible = new Set(fcfs.map((s) => s.email));

  const previousByStudent = new Map<string, ScheduleAssignment[]>();
  for (const row of input.previous) {
    const list = previousByStudent.get(row.studentEmail);
    if (list) list.push(row);
    else previousByStudent.set(row.studentEmail, [row]);
  }
  const droppedStudents = [...previousByStudent.keys()]
    .filter((email) => !eligible.has(email))
    .sort(byEmail);

  const assignments: ScheduleAssignment[] = [];
  const reports: StudentScheduleReport[] = [];
  const skippedNoPosition: string[] = [];
  let droppedBlockGone = 0;

  // Frozen students first: their carried seats must be on the ledger before
  // anyone else competes for capacity.
  for (const student of fcfs.filter((s) => s.scheduled)) {
    const ranges = new Map<Day, TimeRange[]>();
    let cohort: StudentScheduleReport["cohort"] = null;
    const rows = (previousByStudent.get(student.email) ?? []).filter((row) => {
      if (!blockById.has(row.blockId)) {
        droppedBlockGone += 1;
        return false;
      }
      return true;
    });
    rows.sort(
      (a, b) => DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)! || byEmail(a.blockId, b.blockId),
    );
    for (const row of rows) {
      const block = blockById.get(row.blockId)!;
      ledger.add(row.blockId, row.day, row.cohort);
      const list = ranges.get(row.day) ?? [];
      list.push({ start: block.start, end: block.end });
      ranges.set(row.day, list);
      if (row.cohort !== "weekday") {
        cohort = row.cohort;
        addWeekendMinutes(weekendMinutes, row.cohort, block.end - block.start);
      }
      assignments.push(row);
    }
    const position = student.positionId ? positionById.get(student.positionId) : undefined;
    reports.push({
      email: student.email,
      targetMinutes: position ? targetMinutes(student, position) : 0,
      assignedMinutes: averagedAssignedMinutes(ranges, student.everyWeekendOptIn),
      daysUsed: ranges.size,
      cohort,
      frozen: true,
    });
  }

  const states: ActiveState[] = [];
  for (const student of fcfs.filter((s) => !s.scheduled)) {
    const position = student.positionId ? positionById.get(student.positionId) : undefined;
    if (!position) {
      skippedNoPosition.push(student.email);
      continue;
    }
    const state: ActiveState = {
      student,
      position,
      target: targetMinutes(student, position),
      ranges: new Map(),
      taken: new Set(),
      cohort: student.everyWeekendOptIn ? "every" : null,
      assignments: [],
    };
    states.push(state);
    placeStudent(state, blockById, ledger, weekendMinutes, params);
    assignments.push(...state.assignments);
  }

  const improved = improveAssignments(assignments, input.students, input.blocks, params);

  // Rebuild per-student coverage from the final rows so reports reflect any
  // relocations the improvement pass made.
  const finalRanges = new Map<string, Map<Day, TimeRange[]>>();
  for (const row of improved.assignments) {
    const block = blockById.get(row.blockId)!;
    let byDay = finalRanges.get(row.studentEmail);
    if (!byDay) {
      byDay = new Map();
      finalRanges.set(row.studentEmail, byDay);
    }
    const list = byDay.get(row.day) ?? [];
    list.push({ start: block.start, end: block.end });
    byDay.set(row.day, list);
  }

  let shortOfTarget = 0;
  let belowMinDays = 0;
  for (const state of states) {
    const ranges = finalRanges.get(state.student.email) ?? new Map<Day, TimeRange[]>();
    const assigned = averagedAssignedMinutes(ranges, state.student.everyWeekendOptIn);
    if (assigned + EPSILON_MINUTES < state.target) shortOfTarget += 1;
    if (ranges.size < state.position.minDays) belowMinDays += 1;
    reports.push({
      email: state.student.email,
      targetMinutes: state.target,
      assignedMinutes: assigned,
      daysUsed: ranges.size,
      cohort: state.cohort,
      frozen: false,
    });
  }

  return {
    assignments: improved.assignments,
    report: {
      students: reports,
      droppedStudents,
      droppedBlockGone,
      skippedNoPosition,
      shortOfTarget,
      belowMinDays,
      params,
    },
  };
}

interface Candidate {
  block: ShiftBlock;
  day: Day;
}

/** Seed the minimum day span, then fill open days first until target hours. */
function placeStudent(
  state: ActiveState,
  blockById: Map<string, ShiftBlock>,
  ledger: SeatLedger,
  weekendMinutes: { a: number; b: number },
  params: SchedulingParams,
): void {
  const { student, position } = state;

  // Non-exempt students belong on the weekend rotation (PLAN §5 #5), so one
  // seed is the best weekend cell they offered; the rest span new days.
  if (!position.weekendExempt) {
    const weekend = bestCandidate(state, blockById, ledger, params, {
      daysOpen: false,
      weekendOnly: true,
    });
    if (weekend) assign(state, weekend, ledger, weekendMinutes);
  }
  while (state.ranges.size < position.minDays) {
    const seed = bestCandidate(state, blockById, ledger, params, { daysOpen: false });
    if (!seed) break;
    assign(state, seed, ledger, weekendMinutes);
  }

  const maxSteps = student.selection.length;
  for (let i = 0; i < maxSteps; i++) {
    const assigned = averagedAssignedMinutes(state.ranges, student.everyWeekendOptIn);
    if (assigned + EPSILON_MINUTES >= state.target) break;
    const next =
      bestCandidate(state, blockById, ledger, params, { daysOpen: true }) ??
      bestCandidate(state, blockById, ledger, params, { daysOpen: false });
    if (!next) break;
    assign(state, next, ledger, weekendMinutes);
  }
}

/**
 * The best feasible cell from the student's own selections, restricted to
 * already-open or still-unopened days. Cells with a target come first, ranked
 * by pull (unmet share of target plus the tunable tier bonus, so late cells
 * run ahead by about that share instead of soaking up every seat); untargeted
 * cells follow, ranked by tier bonus alone. Ties break on day order, then
 * block id (total, deterministic).
 */
function bestCandidate(
  state: ActiveState,
  blockById: Map<string, ShiftBlock>,
  ledger: SeatLedger,
  params: SchedulingParams,
  filter: { daysOpen: boolean; weekendOnly?: boolean },
): Candidate | null {
  const dayCapMinutes = params.dayCapHours * 60;
  let best: Candidate | null = null;
  let bestTargeted = false;
  let bestPull = 0;

  for (const cell of state.student.selection) {
    const block = blockById.get(cell.blockId);
    if (!block || block.positionId !== state.student.positionId) continue;
    if (filter.weekendOnly && block.dayType !== "weekend") continue;
    if (state.taken.has(demandCellKey(cell.blockId, cell.day))) continue;
    const dayRanges = state.ranges.get(cell.day);
    const dayOpen = dayRanges !== undefined && dayRanges.length > 0;
    if (filter.daysOpen !== dayOpen) continue;

    const cohortContext = block.dayType === "weekend" ? state.cohort : "weekday";
    if (!ledger.fits(block, cell.day, cohortContext)) continue;

    const range: TimeRange = { start: block.start, end: block.end };
    if (dayOpen) {
      if (dayRanges.some((r) => overlaps(r, range))) continue;
      if (coveredMinutes([...dayRanges, range]) > dayCapMinutes) continue;
    }

    const targeted = block.desiredCapacity != null;
    const bonus = tierBonus(block, params);
    const pull = targeted ? ledger.need(block, cell.day, cohortContext) + bonus : bonus;
    if (
      best === null ||
      (targeted && !bestTargeted) ||
      (targeted === bestTargeted &&
        (pull > bestPull ||
          (pull === bestPull &&
            (DAY_INDEX.get(cell.day)! < DAY_INDEX.get(best.day)! ||
              (cell.day === best.day && cell.blockId < best.block.id)))))
    ) {
      best = { block, day: cell.day };
      bestTargeted = targeted;
      bestPull = pull;
    }
  }
  return best;
}

/** Commit one cell: pick the rotation on the first weekend seat, update ledgers. */
function assign(
  state: ActiveState,
  candidate: Candidate,
  ledger: SeatLedger,
  weekendMinutes: { a: number; b: number },
): void {
  const { block, day } = candidate;
  let cohort: Cohort = "weekday";
  if (block.dayType === "weekend") {
    if (state.cohort === null) {
      const open = ledger.openCohorts(block, day);
      if (open.a && open.b) {
        state.cohort = weekendMinutes.b < weekendMinutes.a ? "b" : "a";
      } else {
        state.cohort = open.b ? "b" : "a";
      }
    }
    cohort = state.cohort;
    addWeekendMinutes(weekendMinutes, cohort, block.end - block.start);
  }

  ledger.add(block.id, day, cohort);
  state.taken.add(demandCellKey(block.id, day));
  const list = state.ranges.get(day) ?? [];
  list.push({ start: block.start, end: block.end });
  state.ranges.set(day, list);
  state.assignments.push({ studentEmail: state.student.email, blockId: block.id, day, cohort });
}

/** Track per-rotation weekend load for the cohort-balance choice. */
function addWeekendMinutes(
  totals: { a: number; b: number },
  cohort: Exclude<Cohort, "weekday">,
  span: number,
): void {
  if (cohort === "a") totals.a += span;
  else if (cohort === "b") totals.b += span;
  else {
    totals.a += span;
    totals.b += span;
  }
}
