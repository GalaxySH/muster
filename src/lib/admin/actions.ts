"use server";

/**
 * Admin-only mutations from the per-student view (PLAN.md §10a): the
 * "mark scheduled ✓" progress toggle and free-text scheduler notes. Both are
 * admin-gated and operate on the target student's submission. They never touch
 * the student's availability data.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/policy";
import { syncResponsesSheet, type SheetSyncResult } from "./sheet-sync";

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  if (!session.isAdmin) return { ok: false, error: "Admins only." };
  return { ok: true };
}

/** Updates the submission and reports whether a row was actually affected. */
async function updateSubmission(
  studentEmail: string,
  patch: Partial<typeof submissions.$inferInsert>,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const email = normalizeEmail(studentEmail);
  const [sub] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);
  if (!sub) return { ok: false, error: "No submission exists for this student yet." };

  await db.update(submissions).set(patch).where(eq(submissions.id, sub.id));
  revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  revalidatePath("/admin/responses");
  return { ok: true };
}

/** Toggle the W2W "scheduled" progress marker for a student (PLAN §10a). */
export async function setScheduled(
  studentEmail: string,
  scheduled: boolean,
): Promise<AdminActionResult> {
  return updateSubmission(studentEmail, { scheduled });
}

/** Save the scheduler's free-text notes for a student (PLAN §10a). */
export async function saveSchedulerNotes(
  studentEmail: string,
  notes: string,
): Promise<AdminActionResult> {
  const trimmed = notes.trim();
  return updateSubmission(studentEmail, { schedulerNotes: trimmed.length ? trimmed : null });
}

export interface RebuildSheetResult extends AdminActionResult {
  sync?: SheetSyncResult;
}

/**
 * Admin: rebuild the running responses spreadsheet in Drive (PLAN §10, §12).
 * Obeys the 10-minute cooldown; returns the cooldown info so the UI can say
 * when the next rebuild is allowed.
 */
export async function rebuildResponsesSheet(): Promise<RebuildSheetResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    const sync = await syncResponsesSheet();
    revalidatePath("/admin/responses");
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sheet sync failed." };
  }
}
