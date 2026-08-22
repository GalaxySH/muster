/**
 * Types for the recommended-schedule engine (docs/schedule-generation-plan.md).
 *
 * Assignments are recommendations for the human scheduler, drawn only from a
 * student's own shift selections. They live in schedule_assignments rows, a
 * table deliberately separate from shift_selections: preferences (input) and
 * recommendations (output) never share a table.
 */
import type { Day, Position, SelectedShift, ShiftBlock } from "../types";
import type { SchedulingParams } from "./params";
import type { RunStats } from "./stats";

/**
 * Which weekly template an assignment belongs to. Weekday cells are the same
 * every week. A weekend cell lands in the student's A or B rotation week, or in
 * both ("every") for every-weekend opt-ins.
 */
export type Cohort = "weekday" | "a" | "b" | "every";

/**
 * The one weekend rotation a person's assignment rows come to, or null when
 * none of them is a weekend row.
 *
 * Five call sites used to spell this out by hand and they gave three different
 * answers: the engine took the last non-weekday row it walked, the annealing
 * and improvement passes took the first, and the run statistics ranked the
 * values. Row order is not a property of the schedule, it is a property of
 * whichever loop built the array, so the first two answers moved whenever a
 * sort did. This reads the cohort values and nothing else, so every surface
 * labels the same rows the same way.
 *
 * "every" wins outright: that student works both rotation weeks, and calling
 * them "a" would halve their weekend hours and judge them against one week of
 * a fortnight they work twice. Under-reporting is the direction that hurts.
 * "a" before "b" is arbitrary but has to be something, and it is the tie the
 * engine's own rotation pick already breaks that way (`assign` in ./engine.ts)
 * and the order every list shows them in.
 *
 * Collapsing to one answer is lossy on purpose. Rows that mix "a" and "b" have
 * no single rotation, and callers that must not guess do not come here:
 * `laborWarningsForRows` in ./manual.ts spots the mix and declines to warn, and
 * ./validate.ts maps every row by its own cohort so it can see what a collapse
 * would hide.
 */
export function weekendCohortOf(
  rows: readonly { readonly cohort: Cohort }[],
): Exclude<Cohort, "weekday"> | null {
  let found: Exclude<Cohort, "weekday"> | null = null;
  for (const row of rows) {
    if (row.cohort === "every") return "every";
    if (row.cohort === "a") found = "a";
    else if (row.cohort === "b" && found === null) found = "b";
  }
  return found;
}

/** Who wrote an assignment row: the engine's solver, or an admin's manual edit. */
export type AssignmentSource = "engine" | "manual";

/** One recommended (student, block, day) cell. */
export interface ScheduleAssignment {
  studentEmail: string;
  blockId: string;
  day: Day;
  cohort: Cohort;
  /**
   * Absent means engine. Carried on previous-run rows so a frozen student's
   * manual edits survive regeneration; the engine itself never sets it.
   */
  source?: AssignmentSource;
}

/** One eligible student as the engine sees them (submitted, on roster). */
export interface ScheduleStudent {
  email: string;
  positionId: string | null;
  international: boolean;
  everyWeekendOptIn: boolean;
  /** Desired weekly hours from the form; null falls back to the position floor. */
  desiredHours: number | null;
  /** FCFS key: earlier submissions pick first. Null sorts last. */
  submittedAt: Date | null;
  /**
   * Hired before the current hiring cycle (`flow/returner.ts`). Returners are
   * ordered ahead of new hires, which spreads experience across shifts without
   * a per-cell "N experienced" constraint that could not be guaranteed anyway.
   * FCFS still decides everything within each cohort.
   *
   * Resolved by the caller, not here: the check needs a `now` and the engine
   * has no clock. Absent means new hire, which is also what an unknown hire
   * date means, so a roster imported without dates degrades to plain FCFS.
   */
  returner?: boolean;
  /**
   * The admin's "mark scheduled" toggle. A scheduled student is frozen: their
   * assignments from the previous run are carried forward verbatim and no pass
   * may add, remove, or move anything of theirs.
   */
  scheduled: boolean;
  /**
   * Fill-in students, scheduled only into what everyone else left over (roster
   * members with no response, given a stand-in availability). They are placed
   * after the improvement pass has settled everyone else, so a fill-in can
   * never take a seat a responder would have moved into.
   */
  fillIn?: boolean;
  selection: SelectedShift[];
}

export interface EngineInput {
  students: ScheduleStudent[];
  positions: Position[];
  blocks: ShiftBlock[];
  /** The current run's assignments; source of carried-forward frozen rows. */
  previous: ScheduleAssignment[];
  /** Admin-tunable knobs (./params); the defaults apply when absent. */
  params?: SchedulingParams;
  /**
   * Blocks the engine fills only as a last resort: it takes any other feasible
   * cell first and reaches for one of these only when nothing else lets a
   * student meet their minimums. The improvement pass never relocates into
   * them. Shift Lead weekend closes go here, since Shift Leads claim those by
   * hand (PLAN §18a) and the claims never reach the engine. The engine itself
   * stays generic: it knows only that these cells come last.
   */
  deferredBlockIds?: readonly string[];
  /**
   * Emails the previous run scheduled as fill-ins (its report's `fillIn` rows).
   * Their assignments exist only while the non-responder option is on, so
   * losing them means the option was turned off, not that someone left the
   * roster, and they are never reported as dropped.
   */
  previousFillIns?: readonly string[];
}

/** Per-student outcome for the run summary and the admin list. */
export interface StudentScheduleReport {
  email: string;
  /** Cycle-averaged minutes the engine aimed for (desired clamped to floor/cap). */
  targetMinutes: number;
  /** Cycle-averaged minutes the assignments actually cover. */
  assignedMinutes: number;
  daysUsed: number;
  /** Weekend rotation, or null when the student holds no weekend assignment. */
  cohort: Exclude<Cohort, "weekday"> | null;
  frozen: boolean;
  /** Scheduled as a fill-in (no response of their own). Absent on older runs. */
  fillIn?: boolean;
}

export interface EngineReport {
  students: StudentScheduleReport[];
  /** Previous-run students no longer eligible (off roster or unsubmitted); their rows were dropped. */
  droppedStudents: string[];
  /** Carried frozen assignments dropped because their block no longer exists. */
  droppedBlockGone: number;
  /** Eligible students skipped because they have no known position. */
  skippedNoPosition: string[];
  /** Active students whose assigned hours ended below their target. */
  shortOfTarget: number;
  /** Active students spanning fewer days than their position minimum. */
  belowMinDays: number;
  /**
   * Active students whose assigned hours ended below their position's minimum
   * (a subset of shortOfTarget, since the target never sits under the floor).
   * The scheduler fills these in by hand. Absent on pre-overhaul stored runs.
   */
  belowMinHours?: number;
  /** The knobs this run was generated with (absent on pre-0.85 stored runs). */
  params?: SchedulingParams;
  /**
   * Students who took at least one cell only after the labor ladder relaxed a
   * soft rule (short rest or preferred days). Counted at placement time: the
   * improvement pass may later cure the violation, so this reports where the
   * ladder worked, not which violations survive. Absent on pre-labor stored
   * runs.
   */
  laborRelaxed?: { students: number };
  /**
   * Returner ordering as this run saw it (absent on pre-1.13 stored runs).
   * The cutoff is snapshotted because returner status flips on June 1: without
   * it, two runs with identical inputs either side of that date would order
   * differently and "same inputs reproduce same outputs" would quietly stop
   * being true. `unknownHireDate` counts eligible students with no hire date,
   * who are ordered as new hires; when that number is high the ordering has
   * degraded toward plain FCFS and the admin needs to know.
   */
  returners?: {
    /** `yyyy-mm-dd`, the June 1 that divided returners from new hires. */
    cutoff: string;
    count: number;
    unknownHireDate: number;
  };
  /**
   * What the annealing pass (./anneal.ts) did, absent when it was switched off
   * and on every run generated before it existed. The seed and the iteration
   * count are recorded because together they are what makes the run
   * reproducible: same inputs, same knobs, same schedule.
   */
  anneal?: {
    seed: number;
    iterations: number;
    /** Graded targeted seats the pass added over the greedy result. */
    gainedSeats: number;
    /** Students whose hours it trimmed back toward target to free seats. */
    trimmedStudents: number;
  };
  /**
   * Students whose hire date falls after their position went back to work, so
   * the template's earliest shifts cannot be theirs. Stamped by the caller, not
   * the engine, which has no clock and no dates (see `returners`). Absent on
   * pre-1.15 stored runs; an empty list means the run found none.
   */
  lateStarts?: LateStartWarning[];
}

/**
 * The report shape stored in schedule_runs.summary_json: the engine report,
 * plus the repair stamp a repair-only run adds (how many students were kept in
 * place from the imported W2W plan; those show as frozen in the report but are
 * not admin-frozen), plus the statistics snapshot the caller stamps on.
 *
 * Both halves are engine output, so the shape lives here rather than in the
 * reader that happens to parse it. `RunStats` is a type-only import, which
 * erases at build time, so ./stats importing this module back is not a cycle.
 */
export type StoredRunReport = EngineReport & {
  repaired?: { students: number };
  /**
   * The run's health figures as generated (./stats.ts). Absent on runs from
   * before they existed, which render without the section.
   */
  stats?: RunStats;
};

/** One student who starts after the date their position's shifts resume. */
export interface LateStartWarning {
  email: string;
  /** `yyyy-mm-dd` hire date from the roster. */
  hiredOn: string;
  /** `yyyy-mm-dd` the hire date was judged against (position return date, else the semester start). */
  expectedStart: string;
  /** Null only for a frozen student carrying rows with no position set. */
  positionId: string | null;
}

export interface EngineResult {
  assignments: ScheduleAssignment[];
  report: EngineReport;
}
