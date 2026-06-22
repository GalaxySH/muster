"use server";

/**
 * Wizard navigation server actions (PLAN §4, §18b). `confirmRosterInfo` is the
 * "yes, that's me" gate on /me: it records that the student has started (a draft
 * submission row) so /me resumes the flow rather than re-showing the confirm box,
 * then sends them into the orientation page.
 */
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { ensureSubmissionId } from "@/lib/evidence/data";

export async function confirmRosterInfo() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/me");

  const student = await findStudentByEmail(session.email);
  if (student) {
    // Mark "started" so a later visit to /me resumes the flow (see flowStatus).
    await ensureSubmissionId(student.email);
  }
  redirect("/intro");
}
