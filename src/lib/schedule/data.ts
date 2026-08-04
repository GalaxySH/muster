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
} from "@/lib/domain/coverage";
import { demandCellKey, type CellCount } from "@/lib/domain/demand";
import {
  diffRuns,
  frozenSelectionMismatches,
  type RunCell,
  type RunDiff,
} from "@/lib/domain/scheduling/diff";
import { problemGroups, type ProblemGroup } from "@/lib/domain/scheduling/problems";
import type {
  AssignmentSource,
  Cohort,
  EngineReport,
  StudentScheduleReport,
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
    db.select().from(shiftBlocks).where(isNull(shiftBlocks.retiredAt)),
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

/** One eligible student's row in the current run's per-student list. */
export interface ScheduleStudentRow extends StudentScheduleReport {
  displayName: string;
  positionName: string | null;
  /** The live "mark scheduled" toggle (frozen shows the value at generation). */
  scheduled: boolean;
  cells: AssignedCell[];
}

export interface CurrentSchedule {
  runId: string;
  generatedAt: Date;
  generatedBy: string;
  report: EngineReport;
  /** Keyed by demandCellKey(blockId, day). */
  assignedCells: Map<string, AssignedCellCounts>;
  students: ScheduleStudentRow[];
  totalAssignments: number;
  /** The report's warning lines with the students behind each. */
  problems: ProblemGroup[];
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
    })
    .from(scheduleAssignments)
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
  const report = JSON.parse(run.summaryJson) as EngineReport;

  const rows = await db
    .select({
      studentEmail: scheduleAssignments.studentEmail,
      day: scheduleAssignments.day,
      cohort: scheduleAssignments.cohort,
      dayType: shiftBlocks.dayType,
      start: shiftBlocks.startMinutes,
      end: shiftBlocks.endMinutes,
      blockId: shiftBlocks.id,
    })
    .from(scheduleAssignments)
    .innerJoin(shiftBlocks, eq(scheduleAssignments.shiftBlockId, shiftBlocks.id))
    .where(eq(scheduleAssignments.runId, run.id));

  const assignedCells = new Map<string, AssignedCellCounts>();
  const cellsByStudent = new Map<string, AssignedCell[]>();
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
    { displayName: string; positionName: string | null; minDays: number | null; scheduled: boolean }
  >();
  if (emails.length > 0) {
    const infoRows = await db
      .select({
        email: students.email,
        displayName: students.displayName,
        positionName: positions.name,
        minDays: positions.minDays,
        scheduled: submissions.scheduled,
      })
      .from(students)
      .leftJoin(positions, eq(students.positionId, positions.id))
      .leftJoin(submissions, eq(submissions.studentEmail, students.email))
      .where(inArray(students.email, emails));
    for (const r of infoRows) {
      infoByEmail.set(r.email, {
        displayName: r.displayName,
        positionName: r.positionName,
        minDays: r.minDays,
        scheduled: r.scheduled ?? false,
      });
    }
  }

  const studentRows: ScheduleStudentRow[] = report.students.map((s) => {
    const info = infoByEmail.get(s.email);
    return {
      ...s,
      displayName: info?.displayName ?? s.email,
      positionName: info?.positionName ?? null,
      scheduled: info?.scheduled ?? false,
      cells: cellsByStudent.get(s.email) ?? [],
    };
  });
  studentRows.sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.email.localeCompare(b.email),
  );

  return {
    runId: run.id,
    generatedAt: run.generatedAt,
    generatedBy: run.generatedBy,
    report,
    assignedCells,
    students: studentRows,
    totalAssignments: rows.length,
    problems: problemGroups(report, {
      nameOf: (email) => infoByEmail.get(email)?.displayName ?? email,
      minDaysOf: (email) => infoByEmail.get(email)?.minDays ?? null,
    }),
  };
}

/** One run in the history table, with its stored report's headline numbers. */
export interface ScheduleRunListItem {
  id: string;
  generatedAt: Date;
  generatedBy: string;
  status: "current" | "superseded";
  restoredAt: Date | null;
  restoredBy: string | null;
  assignments: number;
  /** Students the run's report covers. */
  students: number;
  shortOfTarget: number;
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
      restoredAt: r.restoredAt,
      restoredBy: r.restoredBy,
      assignments: countByRun.get(r.id) ?? 0,
      students: report.students.length,
      shortOfTarget: report.shortOfTarget,
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
