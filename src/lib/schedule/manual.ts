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
 * re-checked against the batch's evolving rows so the state it lands on is the
 * thing judged; assigning a cell the student never selected is deliberate
 * scheduler prerogative, and labor rule violations come back as warnings on the
 * success result, never refusals. The weekly hour cap is the same shape: hard
 * for the generator since 1.15 (domain/caps.ts), one more warning line here.
 *
 * What this file owns is the transaction: the locking read, the re-read of the
 * current run, the writes, the warnings, and the refresh. Which cells may land
 * and in what order is `planScheduleEdits` (domain/scheduling/manual.ts), pure
 * and tested on its own.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { liveBlocksOnly } from "@/lib/db/blocks";
import {
  internalAvailability,
  scheduleAssignments,
  scheduleRuns,
  shiftBlocks,
  students,
  submissions,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import { hourCap } from "@/lib/domain/caps";
import { laborLimits } from "@/lib/domain/scheduling/labor";
import {
  laborWarningsForRows,
  planScheduleEdits,
  weekMinutesForRows,
  type EditCell,
  type ExistingAssignment,
} from "@/lib/domain/scheduling/manual";
import { storedSchedulingParams } from "@/lib/domain/scheduling/params";
import { isOverMaxHours } from "@/lib/domain/scheduling/problems";
import type { EngineReport } from "@/lib/domain/scheduling/types";
import { toDomainBlock } from "@/lib/db/mappers";
import type { ShiftBlock } from "@/lib/domain/types";
import { loadCurrentRunRow } from "./data";
import { effectiveRotation } from "@/lib/availability/effective";
import { SCHEDULE_SHEET, trySyncSheet } from "@/lib/admin/sheet-sync";

const NO_RUN_MESSAGE = "Generate a schedule first on the schedule page.";
/**
 * The run moved under the save. Named rather than paraphrased because the
 * admin's trial is still on screen and re-composing it against the new run is
 * the only honest next step.
 */
const RUN_MOVED_MESSAGE =
  "The schedule was regenerated while you were editing. Reload the page and make these changes again.";

export interface AssignmentEditResult {
  ok: boolean;
  error?: string;
  /** Labor rule notes on a successful save. The edits are applied anyway. */
  warnings?: string[];
}

/** One (block, day) cell of an edit batch. */
export type ScheduleEditCell = EditCell;

const fail = (error: string): AssignmentEditResult => ({ ok: false, error });

/** Aborts the transaction, carrying the refusal the admin should read. */
class EditRefused extends Error {}

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
 * trial rather than discovering half a save landed. A run that stopped being
 * the current one between the read and the transaction refuses the same way:
 * writing into a superseded run would report success over nothing.
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
  // rotation (PLAN §10a) is resolved by `effectiveRotation`, the one place that
  // rule lives; the join here just brings the internal copy's flag alongside. Driven off `students` rather than
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
  const everyWeekendOptIn = effectiveRotation(profile?.internalOptIn, profile?.everyWeekendOptIn);
  const international = profile?.international ?? false;

  let rows: ExistingAssignment[];
  try {
    rows = await db.transaction(async (tx) => {
      // The run was read before the transaction opened, which only established
      // that there WAS one. Read it again in here: a save racing a regeneration
      // would otherwise write its rows into a run that is no longer current and
      // report success over a schedule nobody is looking at.
      const [live] = await tx
        .select({ id: scheduleRuns.id })
        .from(scheduleRuns)
        .where(eq(scheduleRuns.status, "current"))
        .orderBy(desc(scheduleRuns.generatedAt), desc(scheduleRuns.id))
        .limit(1);
      if (!live || live.id !== run.id) throw new EditRefused(RUN_MOVED_MESSAGE);

      // Locking read, not a plain one: under REPEATABLE READ two admins saving
      // overlapping batches for the same student would each judge their own
      // snapshot, and the committed union could break the day-conflict rule
      // neither batch broke alone. FOR UPDATE holds this student's rows in this
      // run (and the gap they sit in) until commit, so the second save waits
      // and then judges what the first actually left. The join drags the
      // matching block rows into the lock too, which is a fair price: the
      // transaction is short, and block edits are rare by comparison.
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
        )
        .for("update");

      // Only live blocks can be added, and the coverage rule needs their times.
      const wanted = [...new Set(adds.map((a) => a.blockId))];
      const blockById = new Map<string, ShiftBlock>();
      if (wanted.length > 0) {
        const blockRows = await tx
          .select()
          .from(shiftBlocks)
          .where(and(inArray(shiftBlocks.id, wanted), liveBlocksOnly()));
        for (const r of blockRows) blockById.set(r.id, toDomainBlock(r));
      }

      // Everything read, so the whole batch is decided in one pure pass
      // (domain/scheduling/manual.ts) before a single row is written.
      const plan = planScheduleEdits(current, removes, adds, {
        blocks: blockById,
        everyWeekendOptIn,
      });
      if (!plan.ok) throw new EditRefused(plan.error);

      // Deletes before inserts, the order the plan judged them in: an add can
      // be legal only because a removal in the same batch made room for it.
      for (const cell of plan.removes) {
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
      }
      for (const row of plan.inserts) {
        await tx.insert(scheduleAssignments).values({
          runId: run.id,
          studentEmail: email,
          shiftBlockId: row.blockId,
          day: row.day,
          cohort: row.cohort,
          source: "manual",
        });
      }

      return plan.rows;
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
