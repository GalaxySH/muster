/**
 * Server-side reads for the schedule coverage view (roadmap 5.1;
 * docs/schedule-generation-plan.md Phase A).
 *
 * Coverage counts who could be scheduled into each (block × day) cell, so it
 * counts every selection cell of a submitted on-roster student, including the
 * machine-assigned weekend cell (unlike the demand ranking, which reads
 * preferences and excludes it). Off-roster students drop out here the same way
 * they do everywhere else. Selections are read through the effective seam
 * (internal copy when one exists, the student's rows otherwise), matching what
 * the generator schedules.
 */
import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { liveBlocksOnly } from "@/lib/db/blocks";
import {
  positions,
  scheduleAssignments,
  scheduleRuns,
  shiftBlocks,
  students,
  submissions,
} from "@/lib/db/schema";
import { effectiveSelections } from "@/lib/availability/internal";
import { toDomainBlock } from "@/lib/db/mappers";
import {
  buildCoverageRows,
  summarizeCoverage,
  type CoverageRow,
  type CoverageSummary,
} from "@/lib/domain/scheduling/coverage";
import { demandCellKey, type CellCount } from "@/lib/domain/demand";
import {
  diffRuns,
  frozenSelectionMismatches,
  type RunCell,
  type RunDiff,
} from "@/lib/domain/scheduling/diff";
import { weekMinutesForRows, type ExistingAssignment } from "@/lib/domain/scheduling/manual";
import {
  isBelowMinHours,
  isOverMaxHours,
  problemGroups,
  type ProblemGroup,
} from "@/lib/domain/scheduling/problems";
import { isInScope, parseScope, type ScheduleScope } from "@/lib/domain/scheduling/scope";
import {
  runLaborFindings,
  type FrozenReason,
  type LaborFindingView,
} from "@/lib/domain/scheduling/run-warnings";
import {
  weekendCohortOf,
  type AssignmentSource,
  type Cohort,
  type EngineReport,
  type StoredRunReport,
  type StudentScheduleReport,
} from "@/lib/domain/scheduling/types";
import {
  ALL_DAYS,
  type Day,
  type DayType,
  type SelectedShift,
  type ShiftBlock,
} from "@/lib/domain/types";

/** Who the schedule surfaces consider: on-roster students who submitted. */
export const eligibleSubmittedFilter = () =>
  and(eq(students.onRoster, true), eq(submissions.status, "submitted"));

export interface PositionCoverage {
  positionId: string;
  positionName: string;
  weekendExempt: boolean;
  /** On-roster students holding this position. */
  rosterCount: number;
  /** Of those, how many have submitted. */
  responders: number;
  rows: CoverageRow[];
  summary: CoverageSummary;
}

/** Coverage for every active, non-alias position, ordered by name. */
export async function loadCoverage(): Promise<PositionCoverage[]> {
  const db = getDb();
  const onRosterSubmitted = eligibleSubmittedFilter();
  const eff = effectiveSelections();
  const [posRows, blockRows, rosterRows, responderRows, cellRows] = await Promise.all([
    db
      .select()
      .from(positions)
      .where(and(eq(positions.active, true), isNull(positions.mergedIntoId)))
      .orderBy(asc(positions.name)),
    db.select().from(shiftBlocks).where(liveBlocksOnly()),
    db
      .select({ positionId: students.positionId, n: sql<number>`count(*)` })
      .from(students)
      .where(eq(students.onRoster, true))
      .groupBy(students.positionId),
    db
      .select({ positionId: students.positionId, n: sql<number>`count(*)` })
      .from(submissions)
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(onRosterSubmitted)
      .groupBy(students.positionId),
    db
      .select({
        blockId: eff.shiftBlockId,
        day: eff.day,
        count: sql<number>`count(distinct ${eff.submissionId})`,
      })
      .from(eff)
      .innerJoin(submissions, eq(eff.submissionId, submissions.id))
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(onRosterSubmitted)
      .groupBy(eff.shiftBlockId, eff.day),
  ]);

  const rosterCount = new Map(rosterRows.map((r) => [r.positionId, Number(r.n)]));
  const responders = new Map(responderRows.map((r) => [r.positionId, Number(r.n)]));

  const blocksByPosition = new Map<string, ShiftBlock[]>();
  for (const row of blockRows) {
    const block = toDomainBlock(row);
    const list = blocksByPosition.get(block.positionId);
    if (list) list.push(block);
    else blocksByPosition.set(block.positionId, [block]);
  }

  const positionOfBlock = new Map(blockRows.map((b) => [b.id, b.positionId]));
  const countsByPosition = new Map<string, CellCount[]>();
  for (const row of cellRows) {
    const positionId = positionOfBlock.get(row.blockId);
    if (!positionId) continue;
    const cell: CellCount = { blockId: row.blockId, day: row.day as Day, count: Number(row.count) };
    const list = countsByPosition.get(positionId);
    if (list) list.push(cell);
    else countsByPosition.set(positionId, [cell]);
  }

  return posRows.map((p) => {
    const rows = buildCoverageRows(
      blocksByPosition.get(p.id) ?? [],
      countsByPosition.get(p.id) ?? [],
    );
    return {
      positionId: p.id,
      positionName: p.name,
      weekendExempt: p.weekendExempt,
      rosterCount: rosterCount.get(p.id) ?? 0,
      responders: responders.get(p.id) ?? 0,
      rows,
      summary: summarizeCoverage(rows),
    };
  });
}

/** One person behind a coverage cell's count. */
export interface CellPerson {
  email: string;
  displayName: string;
  positionName: string | null;
  /**
   * The weekend cell auto-assign added for them (PLAN §5), not one they picked.
   * Included because the grid's count includes it; flagged because the student
   * never offered it.
   */
  autoAssigned: boolean;
  /**
   * They offered this cell, so they are part of the number the grid shows.
   * False means the run puts them here anyway: an admin placed them by hand,
   * or a fill-in pass used them. Those people are real coverage and the
   * scheduler needs to see them, but they are NOT part of the count.
   */
  offered: boolean;
  /** Already holds this cell in the current run. */
  assignedHere: boolean;
  /** How the assignment got here, when there is one. */
  source: AssignmentSource | null;
  /** The live "mark scheduled" toggle (PLAN §10a: W2W-entry progress). */
  scheduled: boolean;
}

export interface CellAvailability {
  blockId: string;
  day: Day;
  people: CellPerson[];
}

/**
 * The people behind one coverage cell's number.
 *
 * The supply half deliberately mirrors `loadCoverage`'s cell query exactly:
 * the same effective-selections seam, the same eligibility filter, no extra
 * conditions. The list and the number it explains must never disagree, so any
 * change to one belongs in the other. Note the grid counts auto-assigned
 * weekend cells, so this returns those people too rather than quietly
 * filtering them out; they carry `autoAssigned` for the UI to mark.
 *
 * On top of that it returns anyone the current run puts on this cell who did
 * NOT offer it: a manual placement, or a fill-in of someone who never
 * responded. They are `offered: false`, which is what keeps the count honest
 * while still showing the scheduler who is actually working the shift. Asking
 * "who is on this?" and being shown only the people who volunteered for it was
 * the bug this closes.
 */
export async function loadCellAvailability(blockId: string, day: Day): Promise<CellAvailability> {
  const db = getDb();
  const eff = effectiveSelections();
  const currentRun = await loadCurrentRunRow();
  const [rows, assignedRows] = await Promise.all([
    db
      .select({
        email: students.email,
        displayName: students.displayName,
        positionName: positions.name,
        autoAssigned: eff.autoAssigned,
        scheduled: submissions.scheduled,
      })
      .from(eff)
      .innerJoin(submissions, eq(eff.submissionId, submissions.id))
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .leftJoin(positions, eq(students.positionId, positions.id))
      .where(and(eligibleSubmittedFilter(), eq(eff.shiftBlockId, blockId), eq(eff.day, day))),
    currentRun
      ? // Students, not submissions: a fill-in can be assigned here without ever
        // having responded, so the submission join has to be optional.
        db
          .select({
            email: scheduleAssignments.studentEmail,
            source: scheduleAssignments.source,
            displayName: students.displayName,
            positionName: positions.name,
            scheduled: submissions.scheduled,
          })
          .from(scheduleAssignments)
          .innerJoin(students, eq(scheduleAssignments.studentEmail, students.email))
          .leftJoin(positions, eq(students.positionId, positions.id))
          .leftJoin(submissions, eq(submissions.studentEmail, students.email))
          .where(
            and(
              eq(scheduleAssignments.runId, currentRun.id),
              eq(scheduleAssignments.shiftBlockId, blockId),
              eq(scheduleAssignments.day, day),
            ),
          )
      : Promise.resolve([]),
  ]);

  const assignedBy = new Map(assignedRows.map((r) => [r.email, r]));
  // The count is distinct per submission and a student holds one, so collapse
  // to one row per person and the two stay in step.
  const byEmail = new Map<string, CellPerson>();
  for (const row of rows) {
    if (byEmail.has(row.email)) continue;
    byEmail.set(row.email, {
      email: row.email,
      displayName: row.displayName,
      positionName: row.positionName,
      autoAssigned: row.autoAssigned,
      offered: true,
      assignedHere: assignedBy.has(row.email),
      source: assignedBy.get(row.email)?.source ?? null,
      scheduled: row.scheduled ?? false,
    });
  }
  // Assigned without offering. Added after the supply pass so a student who did
  // both keeps the richer row above.
  for (const [email, row] of assignedBy) {
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      email,
      displayName: row.displayName,
      positionName: row.positionName,
      autoAssigned: false,
      offered: false,
      assignedHere: true,
      source: row.source,
      scheduled: row.scheduled ?? false,
    });
  }

  const people = [...byEmail.values()].sort(
    (a, b) =>
      Number(b.offered) - Number(a.offered) ||
      Number(b.assignedHere) - Number(a.assignedHere) ||
      a.displayName.localeCompare(b.displayName) ||
      a.email.localeCompare(b.email),
  );
  return { blockId, day, people };
}

/** Seats a run fills in one cell, per weekend rotation week (weekday uses `a`). */
export interface AssignedCellCounts {
  a: number;
  b: number;
}

/** One assigned shift for the per-student list and the CSV export. */
export interface AssignedCell {
  day: Day;
  dayType: DayType;
  start: number;
  end: number;
  cohort: "weekday" | "a" | "b" | "every";
}

export type { FrozenReason };

/**
 * One eligible student's row in the current run's per-student list.
 *
 * Inherited fields are the run as generated, with one deliberate exception:
 * `assignedMinutes` is re-measured from the run's live assignment rows, so hand
 * edits move it (see `loadScheduleForRun`). `belowMinHours` and `overMaxHours`
 * are derived from that live figure.
 */
export interface ScheduleStudentRow extends StudentScheduleReport {
  displayName: string;
  positionName: string | null;
  /** The live "mark scheduled" toggle (frozen shows the value at generation). */
  scheduled: boolean;
  /** Null when the student was not frozen in this run. */
  frozenReason: FrozenReason | null;
  /** Assigned under their position's hour floor, so the run needs hand filling. */
  belowMinHours: boolean;
  /** Assigned over their own weekly hour cap: 20h international, 30h otherwise. */
  overMaxHours: boolean;
  /** Set when they were hired after their position's shifts resume. */
  lateStart: { expectedStart: string } | null;
  cells: AssignedCell[];
}

export interface CurrentSchedule {
  runId: string;
  generatedAt: Date;
  generatedBy: string;
  report: StoredRunReport;
  /** Which positions this run re-solved; null means the whole roster. */
  scope: ScheduleScope | null;
  /** Keyed by demandCellKey(blockId, day). */
  assignedCells: Map<string, AssignedCellCounts>;
  students: ScheduleStudentRow[];
  totalAssignments: number;
  /** The run's warning lines with the students behind each, hours judged live. */
  problems: ProblemGroup[];
  /** Labor rule violations the independent validator found in these rows. */
  laborFindings: LaborFindingView[];
}

const DAY_INDEX = new Map(ALL_DAYS.map((d, i) => [d, i]));

/** A schedule_runs row as the loaders pass it around. */
export type ScheduleRunRow = typeof scheduleRuns.$inferSelect;

/** The run marked current (newest wins if a race ever leaves two), or null. */
export async function loadCurrentRunRow() {
  const db = getDb();
  const [run] = await db
    .select()
    .from(scheduleRuns)
    .where(eq(scheduleRuns.status, "current"))
    .orderBy(desc(scheduleRuns.generatedAt), desc(scheduleRuns.id))
    .limit(1);
  return run ?? null;
}

/** One current-run row for one student, as the per-student grid reads it. */
export interface StudentAssignment {
  blockId: string;
  day: Day;
  cohort: Cohort;
  source: AssignmentSource;
  /**
   * The block's span, joined here so the page can total the student's scheduled
   * hours off the run's own rows. A retired block still has its row in
   * `shift_blocks`, so a carried assignment on one keeps its span and its hours.
   */
  start: number;
  end: number;
}

export interface StudentCurrentAssignments {
  runId: string;
  cells: StudentAssignment[];
}

/**
 * The current run's rows for one student, or null before any generation. A
 * student with no rows still gets an empty list, so callers can tell "no run
 * yet" from "run holds nothing for them".
 */
export async function loadStudentCurrentAssignments(
  email: string,
): Promise<StudentCurrentAssignments | null> {
  const db = getDb();
  const run = await loadCurrentRunRow();
  if (!run) return null;
  const cells = await db
    .select({
      blockId: scheduleAssignments.shiftBlockId,
      day: scheduleAssignments.day,
      cohort: scheduleAssignments.cohort,
      source: scheduleAssignments.source,
      start: shiftBlocks.startMinutes,
      end: shiftBlocks.endMinutes,
    })
    .from(scheduleAssignments)
    .innerJoin(shiftBlocks, eq(scheduleAssignments.shiftBlockId, shiftBlocks.id))
    .where(and(eq(scheduleAssignments.runId, run.id), eq(scheduleAssignments.studentEmail, email)));
  return { runId: run.id, cells };
}

/** The current run with its per-student rows, or null before any generation. */
export async function loadCurrentSchedule(): Promise<CurrentSchedule | null> {
  const run = await loadCurrentRunRow();
  return run ? loadScheduleForRun(run) : null;
}

/** One run (current or historical) with its per-student rows. */
export async function loadScheduleForRun(run: ScheduleRunRow): Promise<CurrentSchedule> {
  const db = getDb();
  const report = JSON.parse(run.summaryJson) as StoredRunReport;

  // The run's rows as they stand now, hand edits included. The join is on block
  // id alone, never on `retiredAt`: a retired block keeps its `shift_blocks`
  // row, so a carried assignment on one keeps its span and its hours here, the
  // same way `loadStudentCurrentAssignments` reads them for the per-student page.
  const rows = await db
    .select({
      studentEmail: scheduleAssignments.studentEmail,
      day: scheduleAssignments.day,
      cohort: scheduleAssignments.cohort,
      dayType: shiftBlocks.dayType,
      start: shiftBlocks.startMinutes,
      end: shiftBlocks.endMinutes,
      blockId: shiftBlocks.id,
      source: scheduleAssignments.source,
    })
    .from(scheduleAssignments)
    .innerJoin(shiftBlocks, eq(scheduleAssignments.shiftBlockId, shiftBlocks.id))
    .where(eq(scheduleAssignments.runId, run.id));

  const assignedCells = new Map<string, AssignedCellCounts>();
  const cellsByStudent = new Map<string, AssignedCell[]>();
  // The same rows keyed for the hours and rotation measures below, which need
  // the block id the display cells drop.
  const spansByStudent = new Map<string, ExistingAssignment[]>();
  for (const row of rows) {
    const key = demandCellKey(row.blockId, row.day);
    let counts = assignedCells.get(key);
    if (!counts) {
      counts = { a: 0, b: 0 };
      assignedCells.set(key, counts);
    }
    if (row.cohort === "b") counts.b += 1;
    else if (row.cohort === "every") {
      counts.a += 1;
      counts.b += 1;
    } else counts.a += 1;

    const cell: AssignedCell = {
      day: row.day,
      dayType: row.dayType,
      start: row.start,
      end: row.end,
      cohort: row.cohort,
    };
    const list = cellsByStudent.get(row.studentEmail) ?? [];
    list.push(cell);
    cellsByStudent.set(row.studentEmail, list);

    const spans = spansByStudent.get(row.studentEmail) ?? [];
    spans.push({
      blockId: row.blockId,
      day: row.day,
      cohort: row.cohort,
      start: row.start,
      end: row.end,
    });
    spansByStudent.set(row.studentEmail, spans);
  }
  for (const list of cellsByStudent.values()) {
    list.sort((a, b) => DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)! || a.start - b.start);
  }

  // Dropped and skipped students may have no report row; their names still
  // show up in the problem lists, so look them up too.
  const emails = [
    ...new Set([
      ...report.students.map((s) => s.email),
      ...report.droppedStudents,
      ...report.skippedNoPosition,
    ]),
  ];
  const infoByEmail = new Map<
    string,
    {
      displayName: string;
      positionId: string | null;
      positionName: string | null;
      minDays: number | null;
      minHours: number | null;
      international: boolean;
      scheduled: boolean;
    }
  >();
  if (emails.length > 0) {
    const infoRows = await db
      .select({
        email: students.email,
        displayName: students.displayName,
        positionId: students.positionId,
        positionName: positions.name,
        minDays: positions.minDays,
        minHours: positions.minHours,
        international: students.international,
        scheduled: submissions.scheduled,
      })
      .from(students)
      .leftJoin(positions, eq(students.positionId, positions.id))
      .leftJoin(submissions, eq(submissions.studentEmail, students.email))
      .where(inArray(students.email, emails));
    for (const r of infoRows) {
      infoByEmail.set(r.email, {
        displayName: r.displayName,
        positionId: r.positionId,
        positionName: r.positionName,
        minDays: r.minDays,
        minHours: r.minHours,
        international: r.international,
        scheduled: r.scheduled ?? false,
      });
    }
  }

  const scope = parseScope(run.scopeJson);
  const lateStartByEmail = new Map((report.lateStarts ?? []).map((w) => [w.email, w]));
  // Hours and rotation are MEASURED HERE rather than read from the report,
  // because the report is the run as generated and the schedule editor writes
  // its edits straight into these rows: taking the stored figures would leave
  // the hours column, the rotation column, the two pills, and the warning lines
  // frozen at generation time and blind to exactly the hand edits they exist to
  // catch. Same measures the engine reported with (`averagedAssignedMinutes`
  // through `weekMinutesForRows`, and `weekendCohortOf`), so a run nobody has
  // touched reads precisely as it did when it was generated. `daysUsed` still
  // stays as the run recorded it.
  const liveStudents = report.students.map((s) => {
    const spans = spansByStudent.get(s.email) ?? [];
    return {
      ...s,
      assignedMinutes: weekMinutesForRows(spans),
      cohort: weekendCohortOf(spans),
    };
  });
  const studentRows: ScheduleStudentRow[] = liveStudents.map((s) => {
    const info = infoByEmail.get(s.email);
    const scheduled = info?.scheduled ?? false;
    const minHours = info?.minHours ?? null;
    const lateStart = lateStartByEmail.get(s.email);
    // Marked wins over out-of-scope: it is the stronger claim, since it also
    // protects the student from the next unscoped run.
    const frozenReason: FrozenReason | null = !s.frozen
      ? null
      : scheduled
        ? "marked"
        : isInScope(info?.positionId ?? null, scope)
          ? "kept"
          : "out-of-scope";
    return {
      ...s,
      displayName: info?.displayName ?? s.email,
      positionName: info?.positionName ?? null,
      scheduled,
      frozenReason,
      // Same predicate and the same live minutes as the below-min-hours problem
      // group, so the pills and the warning line always count the same people.
      belowMinHours: !s.frozen && isBelowMinHours(s.assignedMinutes, minHours),
      // Frozen rows count here, unlike belowMinHours above: a hand edit on a
      // kept row is the likeliest way somebody ends up over their cap. Measured
      // on the live rows, so the pill appears on the edit that pushes them over
      // and clears on the one that pulls them back.
      overMaxHours: isOverMaxHours(s.assignedMinutes, info?.international ?? false),
      lateStart: lateStart ? { expectedStart: lateStart.expectedStart } : null,
      cells: cellsByStudent.get(s.email) ?? [],
    };
  });
  studentRows.sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.email.localeCompare(b.email),
  );
  const frozenReasonByEmail = new Map(studentRows.map((s) => [s.email, s.frozenReason]));

  return {
    runId: run.id,
    generatedAt: run.generatedAt,
    generatedBy: run.generatedBy,
    report,
    scope,
    assignedCells,
    students: studentRows,
    totalAssignments: rows.length,
    // Fed the live-hours students, not the stored ones, so the hours groups
    // (short of target, below minimum, over maximum) count the same people the
    // pills above mark. The rest of the report is the run as generated, which
    // is what the day-span and dropped/skipped groups still read.
    problems: problemGroups(
      { ...report, students: liveStudents },
      {
        nameOf: (email) => infoByEmail.get(email)?.displayName ?? email,
        minDaysOf: (email) => infoByEmail.get(email)?.minDays ?? null,
        minHoursOf: (email) => infoByEmail.get(email)?.minHours ?? null,
        internationalOf: (email) => infoByEmail.get(email)?.international ?? false,
      },
    ),
    // Read time, not generation time: the rules are re-checked against the
    // run's own params every load, so hand edits made since are judged too.
    // The findings borrow the student list's freeze reasons so both surfaces
    // say the same thing about why someone did not move.
    laborFindings: runLaborFindings(rows, report, {
      nameOf: (email) => infoByEmail.get(email)?.displayName ?? email,
      frozenReasonOf: (email) => frozenReasonByEmail.get(email) ?? null,
    }),
  };
}

/** One run in the history table, with its stored report's headline numbers. */
export interface ScheduleRunListItem {
  id: string;
  generatedAt: Date;
  generatedBy: string;
  status: "current" | "superseded";
  pinned: boolean;
  restoredAt: Date | null;
  restoredBy: string | null;
  assignments: number;
  /** Students the run's report covers. */
  students: number;
  shortOfTarget: number;
  /** The run's own below-minimum count; null on runs stored before it existed. */
  belowMinHours: number | null;
}

/** Every kept run, newest generation first. */
export async function listScheduleRuns(): Promise<ScheduleRunListItem[]> {
  const db = getDb();
  const [runs, counts] = await Promise.all([
    db.select().from(scheduleRuns).orderBy(desc(scheduleRuns.generatedAt), desc(scheduleRuns.id)),
    db
      .select({ runId: scheduleAssignments.runId, n: sql<number>`count(*)` })
      .from(scheduleAssignments)
      .groupBy(scheduleAssignments.runId),
  ]);
  const countByRun = new Map(counts.map((r) => [r.runId, Number(r.n)]));
  return runs.map((r) => {
    const report = JSON.parse(r.summaryJson) as EngineReport;
    return {
      id: r.id,
      generatedAt: r.generatedAt,
      generatedBy: r.generatedBy,
      status: r.status,
      pinned: r.pinned,
      restoredAt: r.restoredAt,
      restoredBy: r.restoredBy,
      assignments: countByRun.get(r.id) ?? 0,
      students: report.students.length,
      shortOfTarget: report.shortOfTarget,
      belowMinHours: report.belowMinHours ?? null,
    };
  });
}

/** One run's assignment rows with their block spans (for diffing and lists). */
export interface RunAssignmentRow extends RunCell {
  start: number;
  end: number;
}

export async function loadRunAssignments(runId: string): Promise<RunAssignmentRow[]> {
  return getDb()
    .select({
      studentEmail: scheduleAssignments.studentEmail,
      blockId: scheduleAssignments.shiftBlockId,
      day: scheduleAssignments.day,
      cohort: scheduleAssignments.cohort,
      source: scheduleAssignments.source,
      start: shiftBlocks.startMinutes,
      end: shiftBlocks.endMinutes,
    })
    .from(scheduleAssignments)
    .innerJoin(shiftBlocks, eq(scheduleAssignments.shiftBlockId, shiftBlocks.id))
    .where(eq(scheduleAssignments.runId, runId));
}

export interface RunDiffData {
  diff: RunDiff;
  /** Display name per diffed student; students gone from the DB keep their email. */
  names: Map<string, string>;
  /** Block time spans for rendering changed cells. */
  spans: Map<string, { start: number; end: number }>;
}

/** Diff two stored runs, or null when either id no longer exists. */
export async function loadRunDiff(
  beforeRunId: string,
  afterRunId: string,
): Promise<RunDiffData | null> {
  const db = getDb();
  const runRows = await db
    .select()
    .from(scheduleRuns)
    .where(inArray(scheduleRuns.id, [beforeRunId, afterRunId]));
  const beforeRun = runRows.find((r) => r.id === beforeRunId);
  const afterRun = runRows.find((r) => r.id === afterRunId);
  if (!beforeRun || !afterRun) return null;

  const [beforeCells, afterCells] = await Promise.all([
    loadRunAssignments(beforeRunId),
    loadRunAssignments(afterRunId),
  ]);
  const beforeReport = JSON.parse(beforeRun.summaryJson) as EngineReport;
  const afterReport = JSON.parse(afterRun.summaryJson) as EngineReport;
  const diff = diffRuns(
    { assignments: beforeCells, students: beforeReport.students },
    { assignments: afterCells, students: afterReport.students },
  );

  const spans = new Map<string, { start: number; end: number }>();
  for (const c of [...beforeCells, ...afterCells]) {
    spans.set(c.blockId, { start: c.start, end: c.end });
  }

  const names = new Map<string, string>();
  const emails = diff.students.map((s) => s.email);
  if (emails.length > 0) {
    const nameRows = await db
      .select({ email: students.email, displayName: students.displayName })
      .from(students)
      .where(inArray(students.email, emails));
    for (const r of nameRows) names.set(r.email, r.displayName);
  }

  return { diff, names, spans };
}

/** One kept (frozen) student whose current-run rows fall outside their picks. */
export interface FrozenMismatchView {
  email: string;
  displayName: string;
  cells: { day: Day; start: number; end: number }[];
}

/**
 * Frozen rows vs edited selections, always against the current run: students
 * marked scheduled keep their rows through regeneration, so a later
 * availability edit can leave a kept row outside their current selections
 * (auto-assigned weekend cells count as selections; the effective seam makes
 * an internal copy count as the current selections). Empty before any run.
 */
export async function loadFrozenMismatches(): Promise<FrozenMismatchView[]> {
  const db = getDb();
  const run = await loadCurrentRunRow();
  if (!run) return [];

  const frozenEligible = and(eligibleSubmittedFilter(), eq(submissions.scheduled, true));
  const eff = effectiveSelections();
  const [assignments, frozenRows, selectionRows] = await Promise.all([
    loadRunAssignments(run.id),
    db
      .select({ email: submissions.studentEmail })
      .from(submissions)
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(frozenEligible),
    db
      .select({
        email: submissions.studentEmail,
        blockId: eff.shiftBlockId,
        day: eff.day,
      })
      .from(eff)
      .innerJoin(submissions, eq(eff.submissionId, submissions.id))
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(frozenEligible),
  ]);

  const selections = new Map<string, SelectedShift[]>();
  for (const row of selectionRows) {
    const list = selections.get(row.email) ?? [];
    list.push({ blockId: row.blockId, day: row.day });
    selections.set(row.email, list);
  }
  const mismatches = frozenSelectionMismatches(
    assignments,
    new Set(frozenRows.map((r) => r.email)),
    selections,
  );
  if (mismatches.length === 0) return [];

  const spans = new Map(assignments.map((a) => [a.blockId, { start: a.start, end: a.end }]));
  const nameRows = await db
    .select({ email: students.email, displayName: students.displayName })
    .from(students)
    .where(
      inArray(
        students.email,
        mismatches.map((m) => m.email),
      ),
    );
  const names = new Map(nameRows.map((r) => [r.email, r.displayName]));

  return mismatches.map((m) => ({
    email: m.email,
    displayName: names.get(m.email) ?? m.email,
    cells: m.cells.map((c) => ({
      day: c.day,
      start: spans.get(c.blockId)?.start ?? 0,
      end: spans.get(c.blockId)?.end ?? 0,
    })),
  }));
}

export interface ScheduleStaleness {
  /** Eligible responses first submitted after the run was generated. */
  newSubmissions: number;
  /** Eligible responses submitted before the run but edited after it. */
  edited: number;
}

/** One position's line in the scope ledger. */
export interface PositionLedgerRow {
  positionId: string;
  positionName: string;
  /**
   * When a kept run last re-solved this position: the newest **generated** run
   * that was either unscoped or named it. Null when no kept run covers it,
   * which after pruning can also mean the covering run has aged out. `Save run`
   * snapshots are excluded, since they solve nothing.
   */
  lastSolvedAt: Date | null;
  /** Eligible responses first submitted since then (all of them when never solved). */
  newSubmissions: number;
  /** Eligible responses submitted before then but edited since. */
  edited: number;
  /** Eligible responders holding this position. */
  responders: number;
}

/**
 * Which slices have been re-solved and what has changed under them since
 * (machinery B of the scoping design). Derived entirely from run history plus
 * each run's stored scope, so nothing new is persisted and the ledger cannot
 * drift out of step with the runs it describes.
 *
 * Counting happens in JS over one flat query rather than a per-position
 * subquery: each position needs a different cutoff, and a few hundred rows is
 * far cheaper than the per-position round trips that shape would invite.
 */
export async function loadScopeLedger(): Promise<PositionLedgerRow[]> {
  const db = getDb();
  const [positionRows, runRows, responderRows] = await Promise.all([
    db.select({ id: positions.id, name: positions.name }).from(positions),
    db
      .select({ generatedAt: scheduleRuns.generatedAt, scopeJson: scheduleRuns.scopeJson })
      .from(scheduleRuns)
      // Generated runs only. A `Save run` snapshot is stamped now and carries
      // the current run's scope, so counting it would silently mark that slice
      // re-solved when nothing had been.
      .where(eq(scheduleRuns.kind, "generated"))
      .orderBy(desc(scheduleRuns.generatedAt), desc(scheduleRuns.id)),
    db
      .select({
        positionId: students.positionId,
        submittedAt: submissions.submittedAt,
        updatedAt: submissions.updatedAt,
      })
      .from(submissions)
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(eligibleSubmittedFilter()),
  ]);

  const runs = runRows.map((r) => ({ at: r.generatedAt, scope: parseScope(r.scopeJson) }));

  return positionRows
    .map((position) => {
      // Runs are already newest-first, so the first covering one is the latest.
      const lastSolvedAt = runs.find((r) => isInScope(position.id, r.scope))?.at ?? null;
      const mine = responderRows.filter((r) => r.positionId === position.id);
      const newSubmissions = mine.filter(
        (r) => !lastSolvedAt || (r.submittedAt !== null && r.submittedAt > lastSolvedAt),
      ).length;
      const edited = lastSolvedAt
        ? mine.filter(
            (r) =>
              r.submittedAt !== null &&
              r.submittedAt <= lastSolvedAt &&
              r.updatedAt !== null &&
              r.updatedAt > lastSolvedAt,
          ).length
        : 0;
      return {
        positionId: position.id,
        positionName: position.name,
        lastSolvedAt,
        newSubmissions,
        edited,
        responders: mine.length,
      };
    })
    .sort((a, b) => a.positionName.localeCompare(b.positionName));
}

/** How much eligible input changed since the current run was generated. */
export async function loadScheduleStaleness(since: Date): Promise<ScheduleStaleness> {
  const [row] = await getDb()
    .select({
      newer: sql<number>`sum(case when ${submissions.submittedAt} > ${since} then 1 else 0 end)`,
      edited: sql<number>`sum(case when ${submissions.submittedAt} <= ${since} and ${submissions.updatedAt} > ${since} then 1 else 0 end)`,
    })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(eligibleSubmittedFilter());
  return { newSubmissions: Number(row?.newer ?? 0), edited: Number(row?.edited ?? 0) };
}
