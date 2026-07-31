"use server";

/**
 * Admin mutations for manual per-assignment overrides on the current run (the
 * per-student grid's schedule mode). Edits mutate the current run's rows in
 * place: no new run per edit, so Update still supersedes them for non-frozen
 * students by design (the freeze model in docs/architecture.md). Manual rows
 * carry source "manual"; removing an engine row is allowed, since the
 * scheduler owns the schedule. The only hard rule is the same-day containment
 * refusal (domain/scheduling/manual.ts); assigning a cell the student never
 * selected is deliberate scheduler prerogative.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { scheduleAssignments, shiftBlocks, submissions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import {
  conflictCovers,
  findDayConflict,
  manualWeekendCohort,
  type ExistingAssignment,
} from "@/lib/domain/scheduling/manual";
import type { Cohort } from "@/lib/domain/scheduling/types";
import { toDomainBlock } from "@/lib/db/mappers";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL, dayTypeOf, type Day } from "@/lib/domain/types";
import { loadCurrentRunRow } from "./data";
import { SCHEDULE_SHEET, trySyncSheet } from "@/lib/admin/sheet-sync";

const NO_RUN_MESSAGE = "Generate a schedule first on the schedule page.";

export interface AssignmentEditResult {
  ok: boolean;
  error?: string;
}

const fail = (error: string): AssignmentEditResult => ({ ok: false, error });

async function refreshAfterEdit(studentEmail: string): Promise<void> {
  revalidatePath(`/admin/students/${encodeURIComponent(studentEmail)}`);
  revalidatePath("/admin/schedule");
  // Keep the Muster Schedule sheet from drifting behind hand edits; the
  // default cooldown batches a burst of cell clicks into one resync, the same
  // way student submits treat the responses sheet.
  await trySyncSheet(SCHEDULE_SHEET);
}

/**
 * Assign one (block, day) cell to a student on the current run, as a manual
 * row. Idempotent when the row already exists (its source is left alone).
 */
export async function setManualAssignment(
  studentEmail: string,
  blockId: string,
  day: Day,
): Promise<AssignmentEditResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return fail(gate.error);
  const email = normalizeEmail(studentEmail);
  if (!email) return fail("No student was named.");

  const db = getDb();
  const run = await loadCurrentRunRow();
  if (!run) return fail(NO_RUN_MESSAGE);

  const [blockRow] = await db
    .select()
    .from(shiftBlocks)
    .where(eq(shiftBlocks.id, blockId))
    .limit(1);
  if (!blockRow) return fail("That shift no longer exists.");
  const block = toDomainBlock(blockRow);
  if (dayTypeOf(day) !== block.dayType) {
    return fail(`That shift does not run on ${DAY_LABEL[day]}.`);
  }

  const existingRows = await db
    .select({
      blockId: scheduleAssignments.shiftBlockId,
      day: scheduleAssignments.day,
      cohort: scheduleAssignments.cohort,
      start: shiftBlocks.startMinutes,
      end: shiftBlocks.endMinutes,
    })
    .from(scheduleAssignments)
    .innerJoin(shiftBlocks, eq(scheduleAssignments.shiftBlockId, shiftBlocks.id))
    .where(and(eq(scheduleAssignments.runId, run.id), eq(scheduleAssignments.studentEmail, email)));
  const existing: ExistingAssignment[] = existingRows;

  if (existing.some((r) => r.blockId === blockId && r.day === day)) return { ok: true };

  const clash = findDayConflict(block, day, existing);
  if (clash) {
    const shift = `${DAY_LABEL[day]} ${formatSpan(clash.start, clash.end)}`;
    return fail(
      conflictCovers(clash, block)
        ? `Their ${shift} shift already covers that time.`
        : `That covers their ${shift} shift. Remove that one first.`,
    );
  }

  let cohort: Cohort = "weekday";
  if (block.dayType === "weekend") {
    const [sub] = await db
      .select({ everyWeekendOptIn: submissions.everyWeekendOptIn })
      .from(submissions)
      .where(eq(submissions.studentEmail, email))
      .limit(1);
    cohort = manualWeekendCohort(existing, sub?.everyWeekendOptIn ?? false);
  }

  await db.insert(scheduleAssignments).values({
    runId: run.id,
    studentEmail: email,
    shiftBlockId: blockId,
    day,
    cohort,
    source: "manual",
  });

  await refreshAfterEdit(email);
  return { ok: true };
}

/**
 * Remove one (block, day) cell from the student's current run. Engine rows may
 * be removed too; the scheduler owns the schedule. Idempotent when no row.
 */
export async function removeManualAssignment(
  studentEmail: string,
  blockId: string,
  day: Day,
): Promise<AssignmentEditResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return fail(gate.error);
  const email = normalizeEmail(studentEmail);
  if (!email) return fail("No student was named.");

  const db = getDb();
  const run = await loadCurrentRunRow();
  if (!run) return fail(NO_RUN_MESSAGE);

  await db
    .delete(scheduleAssignments)
    .where(
      and(
        eq(scheduleAssignments.runId, run.id),
        eq(scheduleAssignments.studentEmail, email),
        eq(scheduleAssignments.shiftBlockId, blockId),
        eq(scheduleAssignments.day, day),
      ),
    );

  await refreshAfterEdit(email);
  return { ok: true };
}
