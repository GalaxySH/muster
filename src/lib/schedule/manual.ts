"use server";

/**
 * Admin mutations for manual per-assignment overrides on the current run (the
 * per-student grid's schedule mode). Edits mutate the current run's rows in
 * place: no new run per edit, so Update still supersedes them for non-frozen
 * students by design (the freeze model in docs/architecture.md). Manual rows
 * carry source "manual"; removing an engine row is allowed, since the
 * scheduler owns the schedule. The only hard rule is that every same-day
 * shift must add unique time (domain/scheduling/manual.ts); assigning a cell
 * the student never selected is deliberate scheduler prerogative, and labor
 * rule violations come back as warnings on the success result, never refusals.
 * The weekly hour cap is the same shape: hard for the generator since 1.15
 * (domain/caps.ts), one more warning line here.
 */
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  internalAvailability,
  scheduleAssignments,
  shiftBlocks,
  students,
  submissions,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import { hourCap } from "@/lib/domain/caps";
import { laborLimits } from "@/lib/domain/scheduling/labor";
import {
  findDayConflict,
  laborWarningsForEdit,
  manualWeekendCohort,
  weekMinutesForEdit,
  type ExistingAssignment,
} from "@/lib/domain/scheduling/manual";
import { storedSchedulingParams } from "@/lib/domain/scheduling/params";
import { isOverMaxHours } from "@/lib/domain/scheduling/problems";
import type { Cohort, EngineReport } from "@/lib/domain/scheduling/types";
import { toDomainBlock } from "@/lib/db/mappers";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL, dayTypeOf, type Day } from "@/lib/domain/types";
import { loadCurrentRunRow } from "./data";
import { SCHEDULE_SHEET, trySyncSheet } from "@/lib/admin/sheet-sync";

const NO_RUN_MESSAGE = "Generate a schedule first on the schedule page.";

export interface AssignmentEditResult {
  ok: boolean;
  error?: string;
  /** Labor rule notes on a successful assignment. The edit is applied anyway. */
  warnings?: string[];
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
    .where(and(eq(shiftBlocks.id, blockId), isNull(shiftBlocks.retiredAt)))
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
    return fail(
      clash.kind === "candidate-covered"
        ? `Their ${DAY_LABEL[day]} shifts already cover ${formatSpan(block.start, block.end)}.`
        : clash.kind === "day-invalid"
          ? `Their ${DAY_LABEL[day]} ${formatSpan(clash.row.start, clash.row.end)} shift already covers nothing new. Remove that one first.`
          : `That would leave their ${DAY_LABEL[day]} ${formatSpan(clash.row.start, clash.row.end)} shift covering nothing new. Remove that one first.`,
    );
  }

  // The student's rotation and their cap context, in one read. Effective
  // rotation (PLAN §10a): the internal copy's rotation wins over the student's
  // own answer when an admin saved one. Driven off `students` rather than
  // `submissions`, so somebody an admin is scheduling before they have answered
  // still yields their `international` flag.
  const [profile] = await db
    .select({
      everyWeekendOptIn: submissions.everyWeekendOptIn,
      internalOptIn: internalAvailability.everyWeekendOptIn,
      international: students.international,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .leftJoin(internalAvailability, eq(internalAvailability.submissionId, submissions.id))
    .where(eq(students.email, email))
    .limit(1);
  const everyWeekendOptIn = profile?.internalOptIn ?? profile?.everyWeekendOptIn ?? false;
  const international = profile?.international ?? false;

  let cohort: Cohort = "weekday";
  if (block.dayType === "weekend") {
    cohort = manualWeekendCohort(existing, everyWeekendOptIn);
  }

  // Labor rules warn, never block, judged against the run's snapshotted
  // params (backfilled and validated for runs predating the labor fields),
  // the same knobs the read-time validator will use. Warn-never-block also
  // means a failure HERE cannot refuse the edit: an unreadable report or a
  // corrupt block range just yields no warnings (readFillIns sets the
  // precedent for tolerating a bad summaryJson).
  let warnings: string[] = [];
  try {
    const storedParams = (JSON.parse(run.summaryJson) as EngineReport).params;
    const limits = laborLimits(storedSchedulingParams(storedParams));
    warnings = laborWarningsForEdit({ block, day }, cohort, existing, limits);
  } catch {
    warnings = [];
  }

  // The weekly hour cap (domain/caps.ts) is a HARD rule for the generator since
  // 1.15 and a warning here, for the same reason the labor rules are: the
  // schedule belongs to the scheduler, and the read-time over-max flag keeps
  // anyone they push over it visible on /admin/schedule afterwards. Judged on
  // `isOverMaxHours`, the flag's own predicate, so the note and the flag agree.
  // Its own try/catch keeps the warn-never-block posture: a range this cannot
  // measure yields no line rather than a refused edit.
  try {
    const week = weekMinutesForEdit({ block, day }, existing, everyWeekendOptIn);
    if (isOverMaxHours(week, international)) {
      warnings.push(`This puts them over their ${hourCap(international)}h weekly cap.`);
    }
  } catch {
    // No line. The edit still lands, exactly as it would with no warnings.
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
  return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
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
