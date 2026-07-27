"use server";

/**
 * Wizard navigation server actions (PLAN §4, §18b). `confirmRosterInfo` is the
 * "yes, that's me" gate on /me: it stamps the student's own confirmation on their
 * (draft) submission so /me resumes the flow rather than re-showing the confirm
 * box, then sends them into the orientation page.
 *
 * This is the only place `confirmed_at` is ever set. Admins can start a submission
 * on a student's behalf, and that row must not stand in for the student's
 * confirmation (see flowStatus).
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { ensureSubmissionId } from "@/lib/evidence/data";

export async function confirmRosterInfo() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/me");

  const student = await findStudentByEmail(session.email);
  if (student) {
    const submissionId = await ensureSubmissionId(student.email);
    const now = new Date();
    // The student acting on their own submission, so it counts as a student-side
    // change: `updated_at` moves (admin writes deliberately leave it alone).
    await getDb()
      .update(submissions)
      .set({ confirmedAt: now, updatedAt: now })
      .where(eq(submissions.id, submissionId));
  }
  redirect("/intro");
}
