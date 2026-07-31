/**
 * Server-side reads for the schedule coverage view (roadmap 5.1;
 * docs/schedule-generation-plan.md Phase A).
 *
 * Coverage counts who could be scheduled into each (block × day) cell, so it
 * counts every selection cell of a submitted on-roster student, including the
 * machine-assigned weekend cell (unlike the demand ranking, which reads
 * preferences and excludes it). Off-roster students drop out here the same way
 * they do everywhere else.
 */
import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  positions,
  scheduleAssignments,
  scheduleRuns,
  shiftBlocks,
  shiftSelections,
  students,
  submissions,
} from "@/lib/db/schema";
import { toDomainBlock } from "@/lib/db/mappers";
import {
  buildCoverageRows,
  summarizeCoverage,
  type CoverageRow,
  type CoverageSummary,
} from "@/lib/domain/coverage";
import { demandCellKey, type CellCount } from "@/lib/domain/demand";
import type {
  AssignmentSource,
  Cohort,
  EngineReport,
  StudentScheduleReport,
} from "@/lib/domain/scheduling/types";
import { ALL_DAYS, type Day, type DayType, type ShiftBlock } from "@/lib/domain/types";

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
  const [posRows, blockRows, rosterRows, responderRows, cellRows] = await Promise.all([
    db
      .select()
      .from(positions)
      .where(and(eq(positions.active, true), isNull(positions.mergedIntoId)))
      .orderBy(asc(positions.name)),
    db.select().from(shiftBlocks),
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
        blockId: shiftSelections.shiftBlockId,
        day: shiftSelections.day,
        count: sql<number>`count(distinct ${shiftSelections.submissionId})`,
      })
      .from(shiftSelections)
      .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(onRosterSubmitted)
      .groupBy(shiftSelections.shiftBlockId, shiftSelections.day),
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
}

const DAY_INDEX = new Map(ALL_DAYS.map((d, i) => [d, i]));

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
  const db = getDb();
  const run = await loadCurrentRunRow();
  if (!run) return null;
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

  const emails = report.students.map((s) => s.email);
  const infoByEmail = new Map<
    string,
    { displayName: string; positionName: string | null; scheduled: boolean }
  >();
  if (emails.length > 0) {
    const infoRows = await db
      .select({
        email: students.email,
        displayName: students.displayName,
        positionName: positions.name,
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
  };
}
