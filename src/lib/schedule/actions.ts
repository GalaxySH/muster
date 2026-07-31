"use server";

/**
 * Admin mutation for the recommended schedule (docs/schedule-generation-plan.md
 * §4): one "Update schedule" action. Students marked scheduled are frozen (their
 * current rows carry forward verbatim); everyone else is re-solved in FCFS
 * order by the pure engine. Runs are append-only: the action writes a new run,
 * flips the old one to superseded, and prunes beyond a retention count, so any
 * generation can be restored later and nothing is ever lost.
 */
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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
import { toDomainBlock, toDomainPosition } from "@/lib/db/mappers";
import { requireAdmin } from "@/lib/auth/require-admin";
import { generateAssignments } from "@/lib/domain/scheduling/engine";
import { validateSchedulingParams, type SchedulingParams } from "@/lib/domain/scheduling/params";
import type { Cohort, ScheduleAssignment, ScheduleStudent } from "@/lib/domain/scheduling/types";
import type { Day } from "@/lib/domain/types";
import { getSchedulingParams, setSetting, SETTING_SCHEDULE_PARAMS } from "@/lib/settings";
import { eligibleSubmittedFilter, loadCurrentRunRow } from "./data";

/** Superseded runs kept for restore before pruning. */
const RUN_RETENTION = 10;

export interface GenerateResult {
  ok: boolean;
  error?: string;
  /** Assignment rows the new run holds (on success). */
  placed?: number;
}

export async function generateSchedule(): Promise<GenerateResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [positionRows, blockRows, studentRows, selectionRows, currentRun, params] =
    await Promise.all([
      db.select().from(positions),
      db.select().from(shiftBlocks),
      db
        .select({
          email: students.email,
          positionId: students.positionId,
          international: students.international,
          everyWeekendOptIn: submissions.everyWeekendOptIn,
          desiredHours: submissions.desiredHours,
          submittedAt: submissions.submittedAt,
          scheduled: submissions.scheduled,
        })
        .from(submissions)
        .innerJoin(students, eq(submissions.studentEmail, students.email))
        .where(eligibleSubmittedFilter()),
      db
        .select({
          email: submissions.studentEmail,
          blockId: shiftSelections.shiftBlockId,
          day: shiftSelections.day,
        })
        .from(shiftSelections)
        .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
        .innerJoin(students, eq(submissions.studentEmail, students.email))
        .where(eligibleSubmittedFilter()),
      loadCurrentRunRow(),
      getSchedulingParams(),
    ]);

  const selectionByEmail = new Map<string, { blockId: string; day: Day }[]>();
  for (const row of selectionRows) {
    const list = selectionByEmail.get(row.email) ?? [];
    list.push({ blockId: row.blockId, day: row.day });
    selectionByEmail.set(row.email, list);
  }

  const engineStudents: ScheduleStudent[] = studentRows.map((r) => ({
    email: r.email,
    positionId: r.positionId,
    international: r.international,
    everyWeekendOptIn: r.everyWeekendOptIn,
    desiredHours: r.desiredHours,
    submittedAt: r.submittedAt,
    scheduled: r.scheduled,
    selection: selectionByEmail.get(r.email) ?? [],
  }));

  const previous: ScheduleAssignment[] = currentRun
    ? (
        await db
          .select({
            studentEmail: scheduleAssignments.studentEmail,
            blockId: scheduleAssignments.shiftBlockId,
            day: scheduleAssignments.day,
            cohort: scheduleAssignments.cohort,
            source: scheduleAssignments.source,
          })
          .from(scheduleAssignments)
          .where(eq(scheduleAssignments.runId, currentRun.id))
      ).map((r) => ({ ...r, cohort: r.cohort as Cohort }))
    : [];

  const result = generateAssignments({
    students: engineStudents,
    positions: positionRows.map(toDomainPosition),
    blocks: blockRows.map(toDomainBlock),
    previous,
    params,
  });

  const runId = randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .update(scheduleRuns)
      .set({ status: "superseded" })
      .where(eq(scheduleRuns.status, "current"));
    await tx.insert(scheduleRuns).values({
      id: runId,
      generatedBy: gate.email,
      status: "current",
      summaryJson: JSON.stringify(result.report),
    });
    // Chunked inserts: a full fall cycle is a few thousand rows.
    const rows = result.assignments.map((a) => ({
      runId,
      studentEmail: a.studentEmail,
      shiftBlockId: a.blockId,
      day: a.day,
      cohort: a.cohort,
      // Frozen students' carried rows keep their source; new rows are the engine's.
      source: a.source ?? ("engine" as const),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(scheduleAssignments).values(rows.slice(i, i + 500));
    }
    const allRuns = await tx
      .select({ id: scheduleRuns.id })
      .from(scheduleRuns)
      .orderBy(desc(scheduleRuns.generatedAt), desc(scheduleRuns.id));
    const stale = allRuns.slice(RUN_RETENTION);
    if (stale.length > 0) {
      await tx.delete(scheduleRuns).where(
        inArray(
          scheduleRuns.id,
          stale.map((r) => r.id),
        ),
      );
    }
  });

  revalidatePath("/admin/schedule");
  return { ok: true, placed: result.assignments.length };
}

export interface SaveParamsResult {
  ok: boolean;
  error?: string;
}

/**
 * Save the engine's tunable knobs (domain/scheduling/params.ts). They apply
 * from the next generation on; each run also snapshots the values it used
 * into its stored report.
 */
export async function saveScheduleParams(params: SchedulingParams): Promise<SaveParamsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const error = validateSchedulingParams(params);
  if (error) return { ok: false, error };

  await setSetting(SETTING_SCHEDULE_PARAMS, JSON.stringify(params));
  revalidatePath("/admin/schedule");
  return { ok: true };
}
