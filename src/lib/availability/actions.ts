"use server";

/**
 * Save/submit the availability form (PLAN.md §7, §8).
 *
 * The server is the authority: it reloads the position's blocks, drops any cells
 * the client shouldn't be able to select, re-runs the rules engine, and refuses
 * to submit when a hard rule fails. Drafts persist regardless so students can
 * come back. Flags/auto-assign are handled in a later phase.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions, shiftSelections } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadPositionWithBlocks } from "./data";
import { validateAvailability } from "@/lib/domain/validation";
import type { SelectedShift } from "@/lib/domain/types";

export interface SaveAvailabilityInput {
  selection: SelectedShift[];
  everyWeekendOptIn: boolean;
  desiredHours: number | null;
  submit: boolean;
}

export interface SaveResult {
  ok: boolean;
  status?: "draft" | "submitted";
  errors: string[];
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

  if (input.submit) {
    const errors = result.checks
      .filter((c) => c.severity === "hard" && !c.passed)
      .map((c) => c.detail);
    if (desiredHours === null) errors.push("Enter your desired weekly hours.");
    if (errors.length > 0) return { ok: false, errors };
  }

  const status = input.submit ? "submitted" : "draft";
  const db = getDb();

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
        submittedAt: input.submit ? new Date() : null,
      });
    }

    // Replace-all selection strategy keeps the write simple and correct.
    await tx.delete(shiftSelections).where(eq(shiftSelections.submissionId, submissionId));
    if (selection.length > 0) {
      await tx
        .insert(shiftSelections)
        .values(selection.map((s) => ({ submissionId, shiftBlockId: s.blockId, day: s.day })));
    }
  });

  revalidatePath("/availability");
  return { ok: true, status, errors: [] };
}
