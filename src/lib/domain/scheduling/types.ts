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

/**
 * Which weekly template an assignment belongs to. Weekday cells are the same
 * every week. A weekend cell lands in the student's A or B rotation week, or in
 * both ("every") for every-weekend opt-ins.
 */
export type Cohort = "weekday" | "a" | "b" | "every";

/** One recommended (student, block, day) cell. */
export interface ScheduleAssignment {
  studentEmail: string;
  blockId: string;
  day: Day;
  cohort: Cohort;
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
   * The admin's "mark scheduled" toggle. A scheduled student is frozen: their
   * assignments from the previous run are carried forward verbatim and no pass
   * may add, remove, or move anything of theirs.
   */
  scheduled: boolean;
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
  /** The knobs this run was generated with (absent on pre-0.81 stored runs). */
  params?: SchedulingParams;
}

export interface EngineResult {
  assignments: ScheduleAssignment[];
  report: EngineReport;
}
