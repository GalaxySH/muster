import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadWizardNav } from "@/lib/flow/data";
import { StudentPage } from "@/components/student/StudentPage";
import { Card, Notice, StepActions } from "@/components/student/ui";
import { contactLabel } from "@/lib/env";
import { getChangeRequestsEnabled, getTravelCutoff } from "@/lib/settings";
import { currentTermId } from "@/lib/terms/working";
import { formatCutoffDate } from "@/lib/domain/travel";

export const metadata: Metadata = { title: "Before you start" };

/**
 * Orientation step (PLAN §4). Concise scheduling-policy reminders + what the
 * student is about to fill out, then "Continue" into the first data step. Reached
 * from the /me confirm-your-info button.
 */
export default async function IntroPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/intro");
  const termId = await currentTermId();
  const student = await findStudentByEmail(session.email, termId);
  if (!student) redirect("/me");
  const nav = await loadWizardNav(session.email, termId);
  const [{ cutoff }, changeRequestsEnabled] = await Promise.all([
    getTravelCutoff(termId),
    getChangeRequestsEnabled(),
  ]);
  const travelBy = formatCutoffDate(cutoff);

  return (
    <StudentPage nav={nav} progressLabel="Before you start">
      <h1>Before you start</h1>
      <p className="sf-muted">
        This form collects your <strong>availability and preferences</strong>. We use them to create
        your schedule. You are <strong>not</strong> scheduling yourself.
      </p>

      <Card>
        <h2>What we need from you</h2>
        <ol className="sf-list">
          <li>
            Upload proof of your course schedule (required) and any mandatory regularly occurring
            academic activities.
          </li>
          <li>
            Set your recurring weekly availability and desired hours. This applies to every week in
            the semester.
          </li>
          <li>Submit any planned travel to be excused.</li>
          <li>Review and submit.</li>
        </ol>
      </Card>

      <Card>
        <h2>How scheduling works</h2>
        <ul className="sf-list">
          <li>
            Scheduling is based primarily on your course schedule, operational needs, and
            availability, in that order.
          </li>
          <li>We do our best to accommodate your preferences, but we cannot guarantee them.</li>
          <li>
            Mark <strong>every</strong> shift you&apos;d be willing to work. These preferences
            decide your availability, not your final schedule.
          </li>
          <li>Selecting more shifts increases your chances of getting the ones you want.</li>
          <li>
            You do <strong>not</strong> need to fill out availability preferences in WhenToWork.
            This form replaces that step.
          </li>
        </ul>
      </Card>

      <Card>
        <h2>Weekends</h2>
        <ul className="sf-list">
          <li>You are required to work a weekend shift.</li>
          <li>
            Weekends run on an <strong>A/B rotation</strong> (a weekend shift every other weekend),
            unless you opt into working every weekend.
          </li>
          <li>You pick the shift time. We pick which of A/B based on operational needs.</li>
        </ul>
      </Card>

      <Notice tone="warning" role="note" title={`Travel deadline: ${travelBy}`}>
        <p>
          Travel during the semester is only excused if you submit it in this form{" "}
          <strong>before {travelBy}</strong>. We will not excuse any travel requested after this
          date.
        </p>
      </Notice>

      <Card>
        <h2>If your availability changes</h2>
        <ul className="sf-list">
          <li>
            {changeRequestsEnabled ? (
              <>
                If your availability changes during the semester,{" "}
                <Link href="/change-requests">submit a change request</Link>.
              </>
            ) : (
              "If your availability changes during the semester, send us an email."
            )}
          </li>
          <li>We will prioritize requests for academic conflicts.</li>
          <li>We will review requests for extenuating circumstances on a case by case basis.</li>
          <li>
            We will always accept <strong>excusal requests</strong> for exams.
          </li>
        </ul>
      </Card>

      <p className="sf-muted">
        If you have questions, contact <strong>{contactLabel}</strong>.
      </p>

      <StepActions backHref="/me" nextHref="/course-schedule" />
    </StudentPage>
  );
}
