/**
 * Annealing pass (docs/generator-anneal-plan.md): exchange-capable local search
 * over the schedule the greedy engine and the improvement pass produced.
 *
 * Why this exists. The greedy pass places students one at a time and never
 * revisits a placement, so a seat taken early by someone who did not need it
 * stays taken. Reordering who goes first cannot fix that (measured: every
 * ordering heuristic and 40 random restarts plateau around 67% of target
 * seats). Exchanges can, because they move a seat out of a cell that has
 * enough and into one that does not. Measured on a production snapshot, this
 * pass took graded fill from 704 of 1094 target seats to 825-834 while
 * HALVING the students left under their position's hour floor.
 *
 * What early responders keep. FCFS no longer decides which cells someone
 * holds, and deliberately so; it decides that they are served first and
 * therefore reach their target. This pass preserves exactly that: no student
 * may end below `min(the hours the greedy pass gave them, their target)`, and
 * every cell always comes from their own selections. Since greedy serves
 * earlier responders first, an early responder's hours are protected by
 * construction, which is the property that keeps them off the scheduler's
 * manual-fixup list. Where the pass can only lift one of two students toward
 * target, the FCFS weight in the objective lifts the earlier one.
 *
 * Determinism is preserved. A seeded PRNG runs a FIXED iteration count, never
 * a time budget: wall time may vary with the machine, the schedule may not, or
 * the diff view, restore, and the tuning harness all lose their footing. The
 * best state seen is what gets returned, so the result can never score below
 * the seed schedule it started from.
 *
 * The feasibility oracle is ./labor.ts, the same module the engine filters
 * through, NOT the independent ./validate.ts. That module's whole value is
 * that it was written blind to the engine side; wiring it into generation
 * would spend the independence that makes its read-time findings evidence of a
 * bug rather than an echo. It keeps judging what this pass produces.
 */
import { demandCellKey } from "../demand";
import { redundantRangeIndex } from "../intervals";
import type { TimeRange } from "../time";
import { WEEKDAY_DAYS, WEEKEND_DAYS, type Day, type Position, type ShiftBlock } from "../types";
import { laborLimits, laborViolations, type LaborLimits } from "./labor";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "./params";
import { isOverMaxHours } from "./problems";
import {
  DAY_INDEX,
  EPSILON_MINUTES,
  SeatLedger,
  averagedAssignedMinutes,
  byEmail,
  byHashedEmail,
  targetMinutes,
} from "./seats";
import type { Cohort, ScheduleAssignment, ScheduleStudent } from "./types";

/**
 * Acceptance temperature, in seats: at the start a one-seat loss is taken
 * about half the time, by the end effectively never. Constants rather than
 * knobs because they are properties of the search, not of the dining hall, and
 * one more admin field is a real cost to the person running this.
 */
const START_TEMPERATURE = 1.5;
const END_TEMPERATURE = 0.02;

/**
 * Weight on the hours term when scoring a move. Small enough that a whole seat
 * always outranks any hours change a single move can make (the largest
 * possible swing is one block, under 0.03 seats at this weight), so hours only
 * ever break ties between moves the seat count rates equally.
 */
const SECONDARY_WEIGHT = 1e-5;

/** Move mix: relocate below the first cut, add below the second, else remove. */
const RELOCATE_SHARE = 0.5;
const ADD_SHARE = 0.85;

/**
 * How much more an hour toward target is worth for the earliest responder than
 * the latest. The whole FCFS entitlement that survives this pass.
 */
const FCFS_SPREAD = 1;

export interface AnnealResult {
  assignments: ScheduleAssignment[];
  /** Seat counts for the rows as they ended up, for any later placement pass. */
  ledger: SeatLedger;
  /** Graded targeted seats gained over the seed schedule; never negative. */
  gainedSeats: number;
  /** Students whose hours the pass trimmed back (never below their floor). */
  trimmedStudents: number;
  /** Moves committed, downhill ones included. */
  accepted: number;
}

/** Small deterministic PRNG; the repo's seeded scripts use the same one. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One cell a student holds or could hold. */
interface Cell {
  key: string;
  block: ShiftBlock;
  day: Day;
}

interface AnnealState {
  student: ScheduleStudent;
  position: Position;
  /** Currently held cells, by demandCellKey. */
  held: Map<string, Cell>;
  /**
   * Every cell the student could hold: their own selections, on live blocks of
   * their own position, minus deferred cells. Deferred cells are absent here
   * and present in `held` when the engine used one, which is exactly the
   * asymmetry the rules ask for: never newly taken, free to vacate.
   */
  options: Cell[];
  /** Weekend rotation, fixed for the whole search (see the header note). */
  cohort: Exclude<Cohort, "weekday"> | null;
  minutes: number;
  target: number;
  /** Hours floor: what greedy gave them, or their target, whichever is less. */
  floorMinutes: number;
  floorDays: number;
  mustKeepWeekend: boolean;
  baselineHard: number;
  baselineSoft: number;
  seedMinutes: number;
  /** Earlier responders weigh more; see FCFS_SPREAD. */
  fcfsWeight: number;
}

/** The cohort an assignment row carries for this student on this block. */
function rowCohort(state: AnnealState, block: ShiftBlock): Cohort | null {
  return block.dayType === "weekend" ? state.cohort : "weekday";
}

/** The student's day-by-day coverage if they held exactly `held`. */
function rangesOf(held: ReadonlyMap<string, Cell>): Map<Day, TimeRange[]> {
  const ranges = new Map<Day, TimeRange[]>();
  for (const cell of held.values()) {
    const range = { start: cell.block.start, end: cell.block.end };
    const list = ranges.get(cell.day);
    if (list) list.push(range);
    else ranges.set(cell.day, [range]);
  }
  return ranges;
}

function countHard(violations: readonly { severity: "hard" | "soft" }[]): number {
  let hard = 0;
  for (const v of violations) if (v.severity === "hard") hard += 1;
  return hard;
}

/**
 * The student's averaged minutes if they held exactly `held`, or null when
 * that set breaks any invariant. Checks run cheapest first, so the labor rules
 * (which build violation detail strings) only see sets that survived
 * everything else.
 *
 * Labor is judged against the SEED's counts rather than absolutely: engine
 * output is hard-clean, so for every student this pass may touch the baseline
 * is zero and this reads as "no hard violations, ever". Phrasing it as a
 * baseline keeps that true without assuming it, and it is a fixed bar rather
 * than a drifting one, so soft violations can never ratchet upward.
 */
function legalMinutes(
  state: AnnealState,
  held: ReadonlyMap<string, Cell>,
  limits: LaborLimits,
): number | null {
  const ranges = rangesOf(held);

  // Every shift on a day must add coverage of its own. Staggered overlaps are
  // legal doubles and merge; a shift the others already cover whole is not.
  for (const list of ranges.values()) {
    if (list.length > 1 && redundantRangeIndex(list) >= 0) return null;
  }

  const minutes = averagedAssignedMinutes(ranges, state.student.everyWeekendOptIn);
  if (isOverMaxHours(minutes, state.student.international)) return null;
  if (minutes + EPSILON_MINUTES < state.floorMinutes) return null;
  if (ranges.size < state.floorDays) return null;
  if (state.mustKeepWeekend) {
    let weekend = false;
    for (const cell of held.values()) {
      if (cell.block.dayType === "weekend") {
        weekend = true;
        break;
      }
    }
    if (!weekend) return null;
  }

  const violations = laborViolations(ranges, state.cohort, limits);
  const hard = countHard(violations);
  if (hard > state.baselineHard) return null;
  if (violations.length - hard > state.baselineSoft) return null;
  return minutes;
}

/** Add or remove one seat, returning the run's graded-fill delta. */
function applySeat(ledger: SeatLedger, cell: Cell, cohort: Cohort, direction: 1 | -1): number {
  const before = ledger.gradedFill(cell.block, cell.day);
  if (direction === 1) ledger.add(cell.block.id, cell.day, cohort);
  else ledger.remove(cell.block.id, cell.day, cohort);
  return ledger.gradedFill(cell.block, cell.day) - before;
}

/** Hours credited toward the objective: overshoot past target scores nothing. */
function creditedMinutes(state: AnnealState, minutes: number): number {
  return Math.min(minutes, state.target) * state.fcfsWeight;
}

/**
 * Improve a generated schedule by exchanging seats between students.
 *
 * `assignments` are the rows as the improvement pass left them; rows belonging
 * to students this pass may not touch (frozen, fill-ins, anyone with no
 * position) pass through verbatim while still holding their seats on the
 * ledger. Fill-ins are excluded because they are placed later on purpose:
 * letting them compete here would undo the guarantee that adding them never
 * changes a responder's schedule.
 */
export function annealAssignments(
  assignments: readonly ScheduleAssignment[],
  students: readonly ScheduleStudent[],
  positions: readonly Position[],
  blocks: readonly ShiftBlock[],
  params: SchedulingParams = DEFAULT_SCHEDULING_PARAMS,
  deferred: ReadonlySet<string> = new Set(),
): AnnealResult {
  const iterations = params.annealIterations;
  const ledger = new SeatLedger();
  for (const row of assignments) ledger.add(row.blockId, row.day, row.cohort);
  if (iterations <= 0) {
    return {
      assignments: assignments.map((a) => ({ ...a })),
      ledger,
      gainedSeats: 0,
      trimmedStudents: 0,
      accepted: 0,
    };
  }

  const limits = laborLimits(params);
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const rowsByStudent = new Map<string, ScheduleAssignment[]>();
  for (const row of assignments) {
    const list = rowsByStudent.get(row.studentEmail);
    if (list) list.push(row);
    else rowsByStudent.set(row.studentEmail, [row]);
  }

  // Movable students, ordered by response time. The order fixes both the FCFS
  // weights and the array the search samples from, so it must be total.
  const movable = students
    .filter((s) => !s.scheduled && s.fillIn !== true && s.positionId !== null)
    .filter((s) => positionById.has(s.positionId!))
    .sort(
      (x, y) =>
        (x.submittedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (y.submittedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || byHashedEmail(x.email, y.email),
    );

  const states: AnnealState[] = [];
  for (const [rank, student] of movable.entries()) {
    const position = positionById.get(student.positionId!)!;
    const rows = rowsByStudent.get(student.email) ?? [];

    const held = new Map<string, Cell>();
    for (const row of rows) {
      const block = blockById.get(row.blockId);
      if (!block) continue;
      held.set(demandCellKey(row.blockId, row.day), {
        key: demandCellKey(row.blockId, row.day),
        block,
        day: row.day,
      });
    }

    const seen = new Set<string>();
    const options: Cell[] = [];
    for (const pick of student.selection) {
      const key = demandCellKey(pick.blockId, pick.day);
      if (seen.has(key)) continue;
      seen.add(key);
      const block = blockById.get(pick.blockId);
      if (!block || block.positionId !== student.positionId) continue;
      if (deferred.has(block.id)) continue;
      options.push({ key, block, day: pick.day });
    }
    options.sort(
      (a, b) => DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)! || byEmail(a.block.id, b.block.id),
    );

    // The rotation the seed put them on: any weekend row's cohort, else
    // "every" for opt-ins, else none (weekday-only, or nobody placed them on a
    // weekend). A student with no rotation takes no weekend cells here; see
    // the deferred cohort work in the plan.
    const weekendRow = rows.find((r) => r.cohort !== "weekday");
    const cohort = (weekendRow?.cohort ?? (student.everyWeekendOptIn ? "every" : null)) as Exclude<
      Cohort,
      "weekday"
    > | null;

    const ranges = rangesOf(held);
    const minutes = averagedAssignedMinutes(ranges, student.everyWeekendOptIn);
    const seedViolations = laborViolations(ranges, cohort, limits);
    const seedHard = countHard(seedViolations);
    const target = targetMinutes(student, position);

    states.push({
      student,
      position,
      held,
      options,
      cohort,
      minutes,
      target,
      // The FCFS entitlement: never below what greedy already secured, and
      // never asked to hold more than their target just to keep a floor.
      floorMinutes: Math.min(minutes, target),
      floorDays: Math.min(ranges.size, position.minDays),
      mustKeepWeekend: [...held.values()].some((c) => c.block.dayType === "weekend"),
      baselineHard: seedHard,
      baselineSoft: seedViolations.length - seedHard,
      seedMinutes: minutes,
      fcfsWeight:
        movable.length < 2
          ? 1
          : 1 + (FCFS_SPREAD * (movable.length - 1 - rank)) / (movable.length - 1),
    });
  }

  if (states.length === 0) {
    return {
      assignments: assignments.map((a) => ({ ...a })),
      ledger,
      gainedSeats: 0,
      trimmedStudents: 0,
      accepted: 0,
    };
  }

  let filled = 0;
  for (const block of blocks) {
    for (const day of block.dayType === "weekend" ? WEEKEND_DAYS : WEEKDAY_DAYS) {
      filled += ledger.gradedFill(block, day);
    }
  }
  let secondary = 0;
  for (const state of states) secondary += creditedMinutes(state, state.minutes);

  const seedFilled = filled;
  let bestFilled = filled;
  let bestSecondary = secondary;
  let bestHeld = states.map((s) => [...s.held.keys()]);
  let accepted = 0;

  const rng = mulberry32(params.annealSeed);
  const decay = Math.pow(END_TEMPERATURE / START_TEMPERATURE, 1 / iterations);
  let temperature = START_TEMPERATURE;

  for (let i = 0; i < iterations; i++) {
    temperature *= decay;
    const state = states[Math.floor(rng() * states.length)]!;
    const roll = rng();

    let removeCell: Cell | null = null;
    let addCell: Cell | null = null;
    const wantRemove = roll < RELOCATE_SHARE || roll >= ADD_SHARE;
    const wantAdd = roll < ADD_SHARE;

    if (wantRemove) {
      if (state.held.size === 0) continue;
      const heldCells = [...state.held.values()];
      removeCell = heldCells[Math.floor(rng() * heldCells.length)]!;
    }
    if (wantAdd) {
      const free = state.options.filter((o) => !state.held.has(o.key));
      if (free.length === 0) continue;
      addCell = free[Math.floor(rng() * free.length)]!;
      // No rotation means no weekend slot to place them in.
      if (addCell.block.dayType === "weekend" && state.cohort === null) continue;
    }
    if (!removeCell && !addCell) continue;

    const candidate = new Map(state.held);
    if (removeCell) candidate.delete(removeCell.key);
    if (addCell) candidate.set(addCell.key, addCell);

    // Legality first: it never touches the ledger, so a rejected move here
    // costs nothing to undo.
    const newMinutes = legalMinutes(state, candidate, limits);
    if (newMinutes === null) continue;

    const addCohort = addCell ? rowCohort(state, addCell.block) : null;
    if (addCell) {
      if (addCohort === null) continue;
      if (!ledger.fits(addCell.block, addCell.day, addCohort)) continue;
    }

    // Seat deltas need the ledger actually changed, since a weekend cell is
    // graded on its needier week. Applied tentatively, reverted on reject.
    let filledDelta = 0;
    const removeCohort = removeCell ? rowCohort(state, removeCell.block) : null;
    if (removeCell && removeCohort !== null) {
      filledDelta += applySeat(ledger, removeCell, removeCohort, -1);
    }
    if (addCell && addCohort !== null) {
      filledDelta += applySeat(ledger, addCell, addCohort, 1);
    }

    const secondaryDelta =
      creditedMinutes(state, newMinutes) - creditedMinutes(state, state.minutes);
    const score = filledDelta + SECONDARY_WEIGHT * secondaryDelta;
    if (score < 0 && rng() >= Math.exp(score / temperature)) {
      if (addCell && addCohort !== null) applySeat(ledger, addCell, addCohort, -1);
      if (removeCell && removeCohort !== null) applySeat(ledger, removeCell, removeCohort, 1);
      continue;
    }

    state.held = candidate;
    state.minutes = newMinutes;
    filled += filledDelta;
    secondary += secondaryDelta;
    accepted += 1;

    // Seats first, hours only as the tie-break, so no accumulation of small
    // hour gains can ever mask the loss of a seat.
    if (
      filled > bestFilled ||
      (filled === bestFilled && secondary > bestSecondary + EPSILON_MINUTES)
    ) {
      bestFilled = filled;
      bestSecondary = secondary;
      bestHeld = states.map((s) => [...s.held.keys()]);
    }
  }

  // Return the best state seen, not wherever the walk ended.
  const managed = new Set(states.map((s) => s.student.email));
  const out: ScheduleAssignment[] = assignments
    .filter((row) => !managed.has(row.studentEmail))
    .map((a) => ({ ...a }));

  let trimmedStudents = 0;
  for (const [index, state] of states.entries()) {
    const held = new Map<string, Cell>();
    for (const key of bestHeld[index]!) {
      const cell = state.held.get(key) ?? state.options.find((o) => o.key === key);
      if (cell) held.set(key, cell);
    }
    const cells = [...held.values()].sort(
      (a, b) => DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)! || byEmail(a.block.id, b.block.id),
    );
    for (const cell of cells) {
      const cohort = rowCohort(state, cell.block);
      if (cohort === null) continue;
      out.push({
        studentEmail: state.student.email,
        blockId: cell.block.id,
        day: cell.day,
        cohort,
      });
    }
    const finalMinutes = averagedAssignedMinutes(rangesOf(held), state.student.everyWeekendOptIn);
    if (finalMinutes + EPSILON_MINUTES < state.seedMinutes) trimmedStudents += 1;
  }

  // Rebuilt rather than unwound, so the ledger the fill-in pass reads can never
  // drift from the rows actually returned.
  const finalLedger = new SeatLedger();
  for (const row of out) finalLedger.add(row.blockId, row.day, row.cohort);

  return {
    assignments: out,
    ledger: finalLedger,
    gainedSeats: bestFilled - seedFilled,
    trimmedStudents,
    accepted,
  };
}
