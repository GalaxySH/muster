"use server";

/**
 * Save/submit the availability form (PLAN.md §7, §8).
 *
 * The server is the authority: it reloads the position's blocks, drops any cells
 * the client shouldn't be able to select, re-runs the rules engine, and refuses
 * to submit when a hard rule fails. Drafts persist regardless so students can
 * come back.
 *
 * On submit it also resolves the one soft rule that requires server action: a
 * non-exempt student who picked no weekend shift gets one auto-assigned (PLAN
 * §5 #5) and a matching flag is written for the scheduler. Auto-assignment and
 * flags are submit-time only — a draft clears both.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions, shiftSelections, flags, travelRequests } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadPositionWithBlocks } from "./data";
import { validateAvailability } from "@/lib/domain/validation";
import { chooseWeekendAutoAssign, needsWeekendAutoAssign } from "@/lib/domain/auto-assign";
import { trySyncResponsesSheet } from "@/lib/admin/sheet-sync";
import { formatTime } from "@/lib/domain/time";
import type { Day, SelectedShift, ShiftBlock } from "@/lib/domain/types";

export interface SaveAvailabilityInput {
  selection: SelectedShift[];
  everyWeekendOptIn: boolean;
  desiredHours: number | null;
  /** Free-text note the student adds about their requested schedule (PLAN §7). */
  notes: string;
  submit: boolean;
}

export interface AutoAssignedShift extends SelectedShift {
  /** Human label for the chosen cell, e.g. "Sat 8:30a–11a". */
  label: string;
}

export interface SaveResult {
  ok: boolean;
  status?: "draft" | "submitted";
  /** Set when a weekend shift was auto-assigned on this submit. */
  autoAssigned?: AutoAssignedShift | null;
  errors: string[];
}

const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function describeCell(cell: SelectedShift, blocks: ShiftBlock[]): string {
  const block = blocks.find((b) => b.id === cell.blockId);
  if (!block) return DAY_LABEL[cell.day];
  return `${DAY_LABEL[cell.day]} ${formatTime(block.start)}–${formatTime(block.end)}`;
}

export async function saveAvailability(input: SaveAvailabilityInput): Promise<SaveResult> {
  const session = await getAppSession();
  if (!session) return { ok: false, errors: ["You are not signed in."] };

  const student = await findStudentByEmail(session.email);
  if (!student) return { ok: false, errors: ["You are not on the roster."] };
  if (!student.positionId)
    return { ok: false, errors: ["No position is set for your account yet."] };

  const posWithBlocks = await loadPositionWithBlocks(student.positionId);
  if (!posWithBlocks) return { ok: false, errors: ["Your position configuration is missing."] };
  const { position, blocks } = posWithBlocks;

  // Trust only cells that belong to this position's blocks.
  const validIds = new Set(blocks.map((b) => b.id));
  const selection = input.selection.filter((s) => validIds.has(s.blockId));

  const result = validateAvailability(selection, position, blocks, {
    everyWeekendOptIn: input.everyWeekendOptIn,
  });

  const desiredHours = input.desiredHours && input.desiredHours > 0 ? input.desiredHours : null;
  const studentNotes = input.notes.trim() || null;

  if (input.submit) {
    const errors = result.checks
      .filter((c) => c.severity === "hard" && !c.passed)
      .map((c) => c.detail);
    if (desiredHours === null) errors.push("Enter your desired weekly hours.");
    if (errors.length > 0) return { ok: false, errors };
  }

  const status = input.submit ? "submitted" : "draft";
  const willAutoAssign = input.submit && needsWeekendAutoAssign(selection, position);
  const db = getDb();

  let autoAssigned: AutoAssignedShift | null = null;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: submissions.id, submittedAt: submissions.submittedAt })
      .from(submissions)
      .where(eq(submissions.studentEmail, student.email))
      .limit(1);

    let submissionId: string;
    if (existing) {
      submissionId = existing.id;
      await tx
        .update(submissions)
        .set({
          status,
          everyWeekendOptIn: input.everyWeekendOptIn,
          desiredHours,
          studentNotes,
          submittedAt: input.submit ? new Date() : existing.submittedAt,
        })
        .where(eq(submissions.id, submissionId));
    } else {
      submissionId = randomUUID();
      await tx.insert(submissions).values({
        id: submissionId,
        studentEmail: student.email,
        status,
        everyWeekendOptIn: input.everyWeekendOptIn,
        desiredHours,
        studentNotes,
        submittedAt: input.submit ? new Date() : null,
      });
    }

    // Reuse a prior machine-pick so a re-submit keeps the same weekend cell.
    let chosen: SelectedShift | null = null;
    if (willAutoAssign) {
      const priorRows = await tx
        .select({
          blockId: shiftSelections.shiftBlockId,
          day: shiftSelections.day,
          autoAssigned: shiftSelections.autoAssigned,
        })
        .from(shiftSelections)
        .where(eq(shiftSelections.submissionId, submissionId));
      const preferred = priorRows.find((r) => r.autoAssigned) ?? null;
      chosen = chooseWeekendAutoAssign(blocks, {
        preferred: preferred ? { blockId: preferred.blockId, day: preferred.day } : null,
      });
    }

    // Replace-all selection strategy keeps the write simple and correct.
    await tx.delete(shiftSelections).where(eq(shiftSelections.submissionId, submissionId));
    const rows = selection.map((s) => ({
      submissionId,
      shiftBlockId: s.blockId,
      day: s.day,
      autoAssigned: false,
    }));
    if (chosen) {
      rows.push({ submissionId, shiftBlockId: chosen.blockId, day: chosen.day, autoAssigned: true });
      autoAssigned = { ...chosen, label: describeCell(chosen, blocks) };
    }
    if (rows.length > 0) await tx.insert(shiftSelections).values(rows);

    // Flags are recomputed from scratch on every save; only a submit raises them.
    await tx.delete(flags).where(eq(flags.submissionId, submissionId));
    if (input.submit) {
      if (autoAssigned) {
        await tx.insert(flags).values({
          id: randomUUID(),
          submissionId,
          type: "auto_assigned_weekend",
          detail: `No weekend shift selected; auto-assigned ${autoAssigned.label}.`,
        });
      }
      // Late travel (created after the 9/1 cutoff) → flag for the scheduler (§8).
      const lateTravel = await tx
        .select({ id: travelRequests.id })
        .from(travelRequests)
        .where(and(eq(travelRequests.submissionId, submissionId), eq(travelRequests.excused, false)));
      if (lateTravel.length > 0) {
        await tx.insert(flags).values({
          id: randomUUID(),
          submissionId,
          type: "travel_late",
          detail: `${lateTravel.length} travel entr${lateTravel.length === 1 ? "y" : "ies"} added after the 9/1 cutoff (not excused).`,
        });
      }
    }
  });

  // Keep the running Drive spreadsheet fresh (rate-limited, best-effort — a
  // sync failure must never fail the student's submit). Drafts don't trigger it.
  if (input.submit) {
    await trySyncResponsesSheet();
  }

  revalidatePath("/availability");
  return { ok: true, status, autoAssigned, errors: [] };
}
