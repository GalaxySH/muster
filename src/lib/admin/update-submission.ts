/**
 * The shared admin write onto a student's submission, used by the per-student
 * server actions. It lives outside the "use server" files on purpose: exported
 * from one, it would become a client-callable action taking an arbitrary patch.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import { ensureSubmissionId } from "@/lib/evidence/data";
import { findStudentByEmail } from "@/lib/roster/lookup";
import type { AdminActionResult } from "./actions";

/**
 * Updates the student's submission, creating an empty draft first if they never
 * started one: a scheduler must be able to put notes and a "scheduled" mark on
 * anyone on the roster, whether or not they ever filled the form in. The draft
 * this creates has no confirmedAt, so the student still counts as a
 * non-responder everywhere (see `responseStatus` in ./data).
 *
 * These are admin writes, so they must never touch `updated_at` — that column
 * means "when the student last changed their answers" (PLAN §9). Nothing here has
 * to opt out: the column is no longer `ON UPDATE CURRENT_TIMESTAMP`, so it moves
 * only when a caller sets it. Don't add it to `patch`.
 */
export async function updateSubmission(
  studentEmail: string,
  patch: Partial<typeof submissions.$inferInsert>,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const email = normalizeEmail(studentEmail);
  // submissions.studentEmail is a foreign key, so an unknown address would fail
  // as a DB error rather than something we can report.
  const student = await findStudentByEmail(email);
  if (!student) return { ok: false, error: "That employee is not a known student." };

  const submissionId = await ensureSubmissionId(email);
  await getDb().update(submissions).set(patch).where(eq(submissions.id, submissionId));
  revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  revalidatePath("/admin/responses");
  return { ok: true };
}
