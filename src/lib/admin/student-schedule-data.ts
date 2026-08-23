/**
 * Server-side read behind the one-student schedule popup: the student's block
 * layout plus their current-run rows, assembled into the pure grid model in
 * ./student-schedule-view.ts.
 *
 * Console-side, not generator-side: the popup is an admin surface that reads a
 * generated run, so it composes `schedule/data.ts` rather than living inside it
 * (plan item A16). The run row itself still comes from loadCurrentRunRow.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { liveBlocksOnly } from "@/lib/db/blocks";
import {
  positions,
  scheduleAssignments,
  shiftBlocks,
  students,
  submissions,
} from "@/lib/db/schema";
import { weekMinutesForRows } from "@/lib/domain/scheduling/manual";
import {
  buildStudentScheduleGrid,
  type StudentScheduleBlock,
  type StudentScheduleGrid,
} from "@/lib/admin/student-schedule-view";
import type { Day } from "@/lib/domain/types";
import type { AssignmentSource, Cohort } from "@/lib/domain/scheduling/types";
import { loadCurrentRunRow } from "@/lib/schedule/data";

export interface StudentScheduleView {
  email: string;
  displayName: string;
  positionName: string | null;
  /** The live "mark scheduled" toggle (PLAN §10a). */
  scheduled: boolean;
  /**
   * What the run comes to per week, cycle-averaged on the rotation the run's own
   * rows carry. Measured with `weekMinutesForRows`, the same measure the schedule
   * page's student table and the per-student grid read, so the three surfaces
   * never quote different hours for the same rows.
   */
  weeklyMinutes: number;
  grid: StudentScheduleGrid;
}

export type StudentScheduleLookup =
  | { kind: "ok"; view: StudentScheduleView }
  | { kind: "no-run" }
  | { kind: "unknown-student" };

/** The popup's whole read: student, mark, layout blocks, current-run cells. */
export async function loadStudentScheduleView(email: string): Promise<StudentScheduleLookup> {
  const db = getDb();
  const run = await loadCurrentRunRow();
  if (!run) return { kind: "no-run" };

  const [student] = await db
    .select({
      email: students.email,
      displayName: students.displayName,
      positionId: students.positionId,
      positionName: positions.name,
      scheduled: submissions.scheduled,
    })
    .from(students)
    .leftJoin(positions, eq(students.positionId, positions.id))
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .where(eq(students.email, email))
    .limit(1);
  if (!student) return { kind: "unknown-student" };

  const cellRows = await db
    .select({
      blockId: scheduleAssignments.shiftBlockId,
      day: scheduleAssignments.day,
      cohort: scheduleAssignments.cohort,
      source: scheduleAssignments.source,
    })
    .from(scheduleAssignments)
    .where(and(eq(scheduleAssignments.runId, run.id), eq(scheduleAssignments.studentEmail, email)));

  // The layout: the position's live blocks, plus whatever blocks the rows sit
  // on (retired ones included), so a carried shift never falls off the grid.
  const assignedIds = [...new Set(cellRows.map((r) => r.blockId))];
  const [layoutRows, assignedBlockRows] = await Promise.all([
    student.positionId
      ? db
          .select()
          .from(shiftBlocks)
          .where(and(eq(shiftBlocks.positionId, student.positionId), liveBlocksOnly()))
      : Promise.resolve([]),
    assignedIds.length > 0
      ? db.select().from(shiftBlocks).where(inArray(shiftBlocks.id, assignedIds))
      : Promise.resolve([]),
  ]);

  const blocks = new Map<string, StudentScheduleBlock>();
  for (const row of [...layoutRows, ...assignedBlockRows]) {
    blocks.set(row.id, {
      id: row.id,
      dayType: row.dayType,
      start: row.startMinutes,
      end: row.endMinutes,
      retired: row.retiredAt !== null,
    });
  }

  const grid = buildStudentScheduleGrid(
    [...blocks.values()],
    cellRows.map((r) => ({
      blockId: r.blockId,
      day: r.day as Day,
      cohort: r.cohort as Cohort,
      source: r.source as AssignmentSource,
    })),
  );

  // Measured off the assignment rows rather than the grid, so a shift carried on
  // a retired block still counts: `blocks` holds those too, the grid does not
  // always have a cell for them.
  const spans = cellRows.flatMap((r) => {
    const block = blocks.get(r.blockId);
    return block
      ? [
          {
            blockId: r.blockId,
            day: r.day as Day,
            cohort: r.cohort as Cohort,
            start: block.start,
            end: block.end,
          },
        ]
      : [];
  });

  return {
    kind: "ok",
    view: {
      email: student.email,
      displayName: student.displayName,
      positionName: student.positionName,
      scheduled: student.scheduled ?? false,
      weeklyMinutes: weekMinutesForRows(spans),
      grid,
    },
  };
}
