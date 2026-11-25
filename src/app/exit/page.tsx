import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { FinishButton } from "@/components/FinishButton";
import { loadWizardNav } from "@/lib/flow/data";
import { StudentPage } from "@/components/student/StudentPage";
import { Notice } from "@/components/student/ui";
import { currentTermId } from "@/lib/terms/working";
import { getTerm } from "@/lib/terms/term-id";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Almost done" };

/**
 * Final wizard step (PLAN §13). Sets expectations (these are preferences, not a
 * schedule) and holds the one button that finalizes the submission.
 */
export default async function ExitPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/exit");
  const termId = await currentTermId();
  const student = await findStudentByEmail(session.email, termId);
  if (!student) redirect("/me");
  const nav = await loadWizardNav(session.email, termId);
  const { scheduleNote } = await getTerm(getDb(), termId);
  const backHref = nav.steps[nav.steps.length - 1]?.href ?? "/me";

  return (
    <StudentPage nav={nav} progressLabel="Review and submit" stepsDone>
      <h1>Almost done</h1>

      <Notice
        tone="info"
        role="note"
        title="Reminder: This submits your schedule preferences, not your schedule."
      >
        <p>
          You haven&apos;t been scheduled yet. We will create your schedule once we have
          everyone&apos;s preferences.
        </p>
        <p>
          {scheduleNote} We will update you if there are any delays. We will send out emails
          notifying you when your schedule is ready.
        </p>
      </Notice>

      <p className="sf-muted">
        You can keep editing your responses until your form window closes.
      </p>

      <FinishButton backHref={backHref} />
    </StudentPage>
  );
}
