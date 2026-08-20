"use server";

/**
 * Admin mutations for manual per-assignment overrides on the current run (the
 * per-student grid's schedule mode). The grid edits a TRIAL locally and saves
 * the batch here in one transaction: every removal and addition lands together
 * or none of them do, so a half-applied schedule is not a state the admin can
 * reach. Edits mutate the current run's rows: no new run per save, so Update
 * still supersedes them for non-frozen students by design (the freeze model in
 * docs/architecture.md). Manual rows carry source "manual"; removing an engine
 * row is allowed, since the scheduler owns the schedule. The only hard rule is
 * that every same-day shift must add unique time (domain/scheduling/manual.ts),
 * re-checked here against the batch's evolving rows so the state it lands on is
 * the thing judged; assigning a cell the student never selected is deliberate
 * scheduler prerogative, and labor rule violations come back as warnings on the
 * success result, never refusals. The weekly hour cap is the same shape: hard
 * for the generator since 1.15 (domain/caps.ts), one more warning line here.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
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
  dayConflictMessage,
  findDayConflict,
  laborWarningsForRows,
  manualWeekendCohort,
  weekMinutesForRows,
  type ExistingAssignment,
} from "@/lib/domain/scheduling/manual";
import { storedSchedulingParams } from "@/lib/domain/scheduling/params";
import { isOverMaxHours } from "@/lib/domain/scheduling/problems";
import type { Cohort, EngineReport } from "@/lib/domain/scheduling/types";
import { toDomainBlock } from "@/lib/db/mappers";
import { formatSpan } from "@/lib/domain/time";
import { ALL_DAYS, DAY_LABEL, dayTypeOf, type Day, type ShiftBlock } from "@/lib/domain/types";
import { loadCurrentRunRow } from "./data";
import { SCHEDULE_SHEET, trySyncSheet } from "@/lib/admin/sheet-sync";

const NO_RUN_MESSAGE = "Generate a schedule first on the schedule page.";

export interface AssignmentEditResult {
  ok: boolean;
  error?: string;
  /** Labor rule notes on a successful save. The edits are applied anyway. */
  warnings?: string[];
}

/** One (block, day) cell of an edit batch. */
export interface ScheduleEditCell {
  blockId: string;
  day: Day;
}

const fail = (error: string): AssignmentEditResult => ({ ok: false, error });

/** Aborts the transaction, carrying the refusal the admin should read. */
class EditRefused extends Error {}

/**
 * Names the cell a refusal is about ("Sat 8a to 12p"), since a batch save can
 * fail on any one of several cells and the admin has to know which to fix.
 * Falls back to the day alone when the block itself is gone.
 */
function cellName(day: Day, block: ShiftBlock | null): string {
  return block ? `${DAY_LABEL[day]} ${formatSpan(block.start, block.end)}` : DAY_LABEL[day];
}

async function refreshAfterEdit(studentEmail: string): Promise<void> {
  revalidatePath(`/admin/students/${encodeURIComponent(studentEmail)}`);
  revalidatePath("/admin/schedule");
  // Keep the Muster Schedule sheet from drifting behind hand edits; the
  // default cooldown batches a burst of saves into one resync, the same way
  // student submits treat the responses sheet.
  await trySyncSheet(SCHEDULE_SHEET);
}

/**
 * Apply one batch of schedule edits to the student's current-run rows: the
 * removals first, then the additions in calendar order, all inside a single
 * transaction. A removal with no row is a no-op, as is an addition of a cell
 * they already hold. Any addition that fails a hard rule aborts the WHOLE
 * batch and comes back naming its cell, so the admin fixes that cell in the
 * trial rather than discovering half a save landed.
 */
export async function applyScheduleEdits(
  studentEmail: string,
  removes: readonly ScheduleEditCell[],
  adds: readonly ScheduleEditCell[],
): Promise<AssignmentEditResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return fail(gate.error);
  const email = normalizeEmail(studentEmail);
  if (!email) return fail("No student was named.");

  const db = getDb();
  const run = await loadCurrentRunRow();
  if (!run) return fail(NO_RUN_MESSAGE);

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

  let rows: ExistingAssignment[];
  try {
    rows = await db.transaction(async (tx) => {
      const current = await tx
        .select({
          blockId: scheduleAssignments.shiftBlockId,
          day: scheduleAssignments.day,
          cohort: scheduleAssignments.cohort,
          start: shiftBlocks.startMinutes,
          end: shiftBlocks.endMinutes,
        })
        .from(scheduleAssignments)
        .innerJoin(shiftBlocks, eq(scheduleAssignments.shiftBlockId, shiftBlocks.id))
        .where(
          and(eq(scheduleAssignments.runId, run.id), eq(scheduleAssignments.studentEmail, email)),
        );
      const state: ExistingAssignment[] = [...current];

      for (const cell of removes) {
        await tx
          .delete(scheduleAssignments)
          .where(
            and(
              eq(scheduleAssignments.runId, run.id),
              eq(scheduleAssignments.studentEmail, email),
              eq(scheduleAssignments.shiftBlockId, cell.blockId),
              eq(scheduleAssignments.day, cell.day),
            ),
          );
        const at = state.findIndex((r) => r.blockId === cell.blockId && r.day === cell.day);
        if (at >= 0) state.splice(at, 1);
      }

      // Only live blocks can be added, and the coverage rule needs their times.
      const wanted = [...new Set(adds.map((a) => a.blockId))];
      const blockById = new Map<string, ShiftBlock>();
      if (wanted.length > 0) {
        const blockRows = await tx
          .select()
          .from(shiftBlocks)
          .where(and(inArray(shiftBlocks.id, wanted), isNull(shiftBlocks.retiredAt)));
        for (const r of blockRows) blockById.set(r.id, toDomainBlock(r));
      }

      // Calendar order, then earliest block: the rule reads a growing day, so
      // the order decides which cell a conflict is reported against. Fixing it
      // here keeps the refusal the same sentence whatever order the grid sent.
      const ordered = [...adds].sort(
        (a, b) =>
          ALL_DAYS.indexOf(a.day) - ALL_DAYS.indexOf(b.day) ||
          (blockById.get(a.blockId)?.start ?? 0) - (blockById.get(b.blockId)?.start ?? 0) ||
          a.blockId.localeCompare(b.blockId),
      );

      for (const cell of ordered) {
        if (state.some((r) => r.blockId === cell.blockId && r.day === cell.day)) continue;
        const block = blockById.get(cell.blockId) ?? null;
        if (!block) {
          throw new EditRefused(`${cellName(cell.day, null)}: That shift no longer exists.`);
        }
        if (dayTypeOf(cell.day) !== block.dayType) {
          throw new EditRefused(
            `${cellName(cell.day, block)}: That shift does not run on ${DAY_LABEL[cell.day]}.`,
          );
        }
        const clash = findDayConflict(block, cell.day, state);
        if (clash) {
          throw new EditRefused(
            `${cellName(cell.day, block)}: ${dayConflictMessage(block, cell.day, clash)}`,
          );
        }

        const cohort: Cohort =
          block.dayType === "weekend" ? manualWeekendCohort(state, everyWeekendOptIn) : "weekday";
        await tx.insert(scheduleAssignments).values({
          runId: run.id,
          studentEmail: email,
          shiftBlockId: cell.blockId,
          day: cell.day,
          cohort,
          source: "manual",
        });
        state.push({
          blockId: cell.blockId,
          day: cell.day,
          cohort,
          start: block.start,
          end: block.end,
        });
      }

      return state;
    });
  } catch (e) {
    if (!(e instanceof EditRefused)) throw e;
    return fail(e.message);
  }

  // One pass over the state the batch landed on, rather than a note per click:
  // the week the admin built is the week worth judging. Labor rules warn, never
  // block, against the run's snapshotted params (backfilled and validated for
  // runs predating the labor fields), the same knobs the read-time validator
  // will use. Warn-never-block also means a failure HERE cannot undo the save:
  // an unreadable report or a corrupt block range just yields no warnings
  // (readFillIns sets the precedent for tolerating a bad summaryJson).
  let warnings: string[] = [];
  try {
    const storedParams = (JSON.parse(run.summaryJson) as EngineReport).params;
    const limits = laborLimits(storedSchedulingParams(storedParams));
    warnings = laborWarningsForRows(rows, limits);
  } catch {
    warnings = [];
  }

  // The weekly hour cap (domain/caps.ts) is a HARD rule for the generator since
  // 1.15 and a warning here, for the same reason the labor rules are: the
  // schedule belongs to the scheduler, and the read-time over-max flag keeps
  // anyone they push over it visible on /admin/schedule afterwards. Judged on
  // `isOverMaxHours`, the flag's own predicate, so the note and the flag agree.
  // Its own try/catch keeps the warn-never-block posture: a range this cannot
  // measure yields no line rather than a rolled-back save.
  try {
    if (isOverMaxHours(weekMinutesForRows(rows, everyWeekendOptIn), international)) {
      warnings.push(`This puts them over their ${hourCap(international)}h weekly cap.`);
    }
  } catch {
    // No line. The batch still landed, exactly as it would with no warnings.
  }

  await refreshAfterEdit(email);
  return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
}
