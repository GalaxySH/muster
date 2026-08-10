/**
 * Recommended-schedule engine (docs/schedule-generation-plan.md §3).
 *
 * Deterministic greedy: returners first, then first-come-first-serve by
 * submittedAt within each cohort. Early responders pick first among their
 * peers, which is fair, easy to explain, and makes rerunning the engine
 * reproduce unchanged students' schedules (no randomness anywhere). Ranking
 * returners ahead of new hires is how experience gets spread across shifts;
 * the caller resolves that flag, since the check needs a clock and this
 * module has none.
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
 *
 * Fill-in students (roster members with no response, scheduled only when an
 * admin asks for it) come last of all: they are placed after the improvement
 * pass has settled everyone else, against the seats those final rows left, so
 * adding them never changes another student's schedule.
 */
import { hourCap } from "../caps";
import { demandCellKey } from "../demand";
import { coveredMinutes, redundantRangeIndex } from "../intervals";
import type { TimeRange } from "../time";
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

/** Returners sort first (0 before 1); everyone else, including unknown, is a new hire. */
const cohortRank = (s: ScheduleStudent) => (s.returner === true ? 0 : 1);

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
  const deferred = new Set(input.deferredBlockIds ?? []);
  const blockById = new Map(input.blocks.map((b) => [b.id, b]));
  const positionById = new Map(input.positions.map((p) => [p.id, p]));
  const ledger = new SeatLedger();
  const weekendMinutes = { a: 0, b: 0 };

  // Returners first, then first come first served inside each cohort. Putting
  // the cohort ahead of the timestamp is what actually spreads experience:
  // as a tiebreak it would do nothing, since two responses never share a
  // millisecond.
  const fcfs = [...input.students].sort(
    (x, y) =>
      cohortRank(x) - cohortRank(y) || fcfsTime(x) - fcfsTime(y) || byEmail(x.email, y.email),
  );
  const eligible = new Set(fcfs.map((s) => s.email));

  const previousByStudent = new Map<string, ScheduleAssignment[]>();
  for (const row of input.previous) {
    const list = previousByStudent.get(row.studentEmail);
    if (list) list.push(row);
    else previousByStudent.set(row.studentEmail, [row]);
  }
  // A previous run's fill-in rows vanish as soon as the non-responder option is
  // switched off. That is the option changing, not a departure, so those emails
  // never join the dropped list (which reads as "left the roster").
  const wasFillIn = new Set(input.previousFillIns ?? []);
  const droppedStudents = [...previousByStudent.keys()]
    .filter((email) => !eligible.has(email) && !wasFillIn.has(email))
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
      const before = coveredMinutes(list);
      list.push({ start: block.start, end: block.end });
      ranges.set(row.day, list);
      if (row.cohort !== "weekday") {
        cohort = row.cohort;
        addWeekendMinutes(weekendMinutes, row.cohort, coveredMinutes(list) - before);
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
      // Kept in step with the active branch: `previousFillIns` is read off this
      // field, so a fill-in that ever became freezable must still carry it.
      fillIn: student.fillIn === true,
    });
  }

  const states: ActiveState[] = [];
  /** Place one student and record their state; skipped when they hold no position. */
  const place = (student: ScheduleStudent, seats: SeatLedger): ScheduleAssignment[] => {
    const position = student.positionId ? positionById.get(student.positionId) : undefined;
    if (!position) {
      skippedNoPosition.push(student.email);
      return [];
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
    placeStudent(state, blockById, seats, weekendMinutes, params, deferred);
    return state.assignments;
  };

  const active = fcfs.filter((s) => !s.scheduled);
  for (const student of active.filter((s) => !s.fillIn)) {
    assignments.push(...place(student, ledger));
  }

  const improved = improveAssignments(assignments, input.students, input.blocks, params, deferred);

  // Fill-ins go in only once the improvement pass has settled everyone else, so
  // they can never take a seat a responder would have moved into. They run
  // against the ledger those final rows left behind. The weekend load carried
  // over from placement stays good enough to balance their rotations, since it
  // only breaks ties between the A and B weeks.
  const fillInRows: ScheduleAssignment[] = [];
  for (const student of active.filter((s) => s.fillIn)) {
    fillInRows.push(...place(student, improved.ledger));
  }
  const finalAssignments = [...improved.assignments, ...fillInRows];

  // Rebuild per-student coverage from the final rows so reports reflect any
  // relocations the improvement pass made.
  const finalRanges = new Map<string, Map<Day, TimeRange[]>>();
  for (const row of finalAssignments) {
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
    // A fill-in the run found no room for is simply not in it: they stay a
    // non-responder and never count as short of hours or days.
    if (state.student.fillIn && ranges.size === 0) continue;
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
      fillIn: state.student.fillIn === true,
    });
  }

  return {
    assignments: finalAssignments,
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
  deferred: ReadonlySet<string>,
): void {
  const { student, position } = state;

  // Non-exempt students belong on the weekend rotation (PLAN §5 #5), so one
  // seed is the best weekend cell they offered; the rest span new days.
  // Deferred cells rank last everywhere, so a Shift Lead only anchors on a
  // weekend close when they offered no other weekend cell.
  if (!position.weekendExempt) {
    const weekend = bestCandidate(state, blockById, ledger, params, deferred, {
      daysOpen: false,
      weekendOnly: true,
    });
    if (weekend) assign(state, weekend, ledger, weekendMinutes);
  }
  while (state.ranges.size < position.minDays) {
    const seed = bestCandidate(state, blockById, ledger, params, deferred, { daysOpen: false });
    if (!seed) break;
    assign(state, seed, ledger, weekendMinutes);
  }

  const maxSteps = student.selection.length;
  for (let i = 0; i < maxSteps; i++) {
    const assigned = averagedAssignedMinutes(state.ranges, student.everyWeekendOptIn);
    if (assigned + EPSILON_MINUTES >= state.target) break;
    // Ranking alone would not keep deferred cells last here: each call ranks
    // only within its own day filter, so "fill an open day first" would beat
    // the deferred tier and take a close while another day sat free. Both
    // filters therefore run without deferred cells before either retries with
    // them, which is what makes them a genuine last resort.
    const pick = (excludeDeferred: boolean) =>
      bestCandidate(state, blockById, ledger, params, deferred, {
        daysOpen: true,
        excludeDeferred,
      }) ??
      bestCandidate(state, blockById, ledger, params, deferred, {
        daysOpen: false,
        excludeDeferred,
      });
    const next = pick(true) ?? pick(false);
    if (!next) break;
    assign(state, next, ledger, weekendMinutes);
  }
}

/** How one candidate cell ranks; see `outranks` for the ordering. */
interface CandidateRank {
  deferred: boolean;
  targeted: boolean;
  pull: number;
  day: Day;
  blockId: string;
}

/**
 * Candidate ordering, most preferred first: cells the caller deferred come
 * after everything else, then cells with a target beat untargeted ones, then
 * higher pull wins. Ties break on day order and block id, so the order is
 * total and every run reproduces.
 */
function outranks(a: CandidateRank, b: CandidateRank): boolean {
  if (a.deferred !== b.deferred) return !a.deferred;
  if (a.targeted !== b.targeted) return a.targeted;
  if (a.pull !== b.pull) return a.pull > b.pull;
  const dayDelta = DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)!;
  if (dayDelta !== 0) return dayDelta < 0;
  return a.blockId < b.blockId;
}

/**
 * The best feasible cell from the student's own selections, restricted to
 * already-open or still-unopened days. Pull is the unmet share of target plus
 * the tunable tier bonus, so late cells run ahead by about that share instead
 * of soaking up every seat; untargeted cells rank on tier bonus alone. See
 * `outranks` for the full ordering.
 */
function bestCandidate(
  state: ActiveState,
  blockById: Map<string, ShiftBlock>,
  ledger: SeatLedger,
  params: SchedulingParams,
  deferred: ReadonlySet<string>,
  filter: { daysOpen: boolean; weekendOnly?: boolean; excludeDeferred?: boolean },
): Candidate | null {
  const dayCapMinutes = params.dayCapHours * 60;
  let best: Candidate | null = null;
  let bestRank: CandidateRank | null = null;

  for (const cell of state.student.selection) {
    const block = blockById.get(cell.blockId);
    if (!block || block.positionId !== state.student.positionId) continue;
    if (filter.excludeDeferred && deferred.has(block.id)) continue;
    if (filter.weekendOnly && block.dayType !== "weekend") continue;
    if (state.taken.has(demandCellKey(cell.blockId, cell.day))) continue;
    const dayRanges = state.ranges.get(cell.day);
    const dayOpen = dayRanges !== undefined && dayRanges.length > 0;
    if (filter.daysOpen !== dayOpen) continue;

    const cohortContext = block.dayType === "weekend" ? state.cohort : "weekday";
    if (!ledger.fits(block, cell.day, cohortContext)) continue;

    const range: TimeRange = { start: block.start, end: block.end };
    if (dayOpen) {
      // Staggered overlaps are fine (they merge into a double), but every
      // shift on the day must keep at least one minute of unique coverage.
      const daySet = [...dayRanges, range];
      if (redundantRangeIndex(daySet) >= 0) continue;
      if (coveredMinutes(daySet) > dayCapMinutes) continue;
    }

    const targeted = block.desiredCapacity != null;
    const bonus = tierBonus(block, params);
    const rank: CandidateRank = {
      deferred: deferred.has(block.id),
      targeted,
      pull: targeted ? ledger.need(block, cell.day, cohortContext) + bonus : bonus,
      day: cell.day,
      blockId: block.id,
    };
    if (bestRank === null || outranks(rank, bestRank)) {
      best = { block, day: cell.day };
      bestRank = rank;
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
  }

  ledger.add(block.id, day, cohort);
  state.taken.add(demandCellKey(block.id, day));
  const list = state.ranges.get(day) ?? [];
  const before = coveredMinutes(list);
  list.push({ start: block.start, end: block.end });
  state.ranges.set(day, list);
  if (cohort !== "weekday") {
    addWeekendMinutes(weekendMinutes, cohort, coveredMinutes(list) - before);
  }
  state.assignments.push({ studentEmail: state.student.email, blockId: block.id, day, cohort });
}

/**
 * Track per-rotation weekend load for the cohort-balance choice. Callers pass
 * the day's merged-span delta, not the raw block length, so a staggered
 * double's handoff overlap counts once.
 */
function addWeekendMinutes(
  totals: { a: number; b: number },
  cohort: Exclude<Cohort, "weekday">,
  delta: number,
): void {
  if (cohort === "a") totals.a += delta;
  else if (cohort === "b") totals.b += delta;
  else {
    totals.a += delta;
    totals.b += delta;
  }
}
