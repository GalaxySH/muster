import type { Metadata } from "next";
import { WorkingTerm } from "@/components/WorkingTerm";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { listChangeRequests } from "@/lib/changes/data";
import { loadPositionWithBlocks } from "@/lib/availability/data";
import {
  ChangeRequestsPanel,
  type ChangeRequestsAdminProps,
} from "@/components/changes/ChangeRequestsPanel";
import { StudentPage } from "@/components/student/StudentPage";
import { StudentDeadEnd } from "@/components/student/StudentDeadEnd";
import { Card, Notice } from "@/components/student/ui";
import { currentTermId, workingTermId } from "@/lib/terms/working";

export const metadata: Metadata = { title: "Schedule change requests" };

/**
 * The always-available schedule change-request mini-flow (roadmap 3.1).
 * Deliberately outside the wizard and its window gates: any known student can
 * use it all semester, since it concerns their actual W2W schedule.
 */
export default async function ChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/change-requests");

  // Their own requests are the current semester's. An employee an admin acts
  // for is looked up in the semester the admin is working in.
  const ownTermId = await currentTermId();
  const student = await findStudentByEmail(session.email, ownTermId);
  if (!student && !session.isAdmin) {
    return (
      <StudentDeadEnd title="Schedule change requests">
        <Notice tone="warning">
          <p>You&apos;re not a known student, so there&apos;s nothing to request yet.</p>
        </Notice>
      </StudentDeadEnd>
    );
  }

  // Admins get the on-behalf employee field, optionally pre-seeded by the
  // quick link on the per-student admin page (?student=email).
  let admin: ChangeRequestsAdminProps | undefined;
  let target: typeof student = null;
  if (session.isAdmin) {
    const { student: studentParam } = await searchParams;
    target = studentParam ? await findStudentByEmail(studentParam, await workingTermId()) : null;
    admin = {
      initialEmployee: target ? { email: target.email, displayName: target.displayName } : null,
    };
  }

  // The form starts out acting for the pre-seeded employee, else the signer.
  const formFor = target ?? student;
  const requests = formFor
    ? await listChangeRequests(formFor.email, target ? await workingTermId() : ownTermId)
    : [];
  // Its position's shift times become the quick inserts under the shift time box.
  const loaded = formFor?.positionId ? await loadPositionWithBlocks(formFor.positionId) : null;
  const blocks = (loaded?.blocks ?? []).map(({ dayType, start, end }) => ({ dayType, start, end }));

  return (
    <StudentPage>
      <h1>Schedule change requests</h1>
      <p className="sf-muted">
        We will review requests for extenuating circumstances on a case by case basis. We cannot
        guarantee that your request can be accommodated. After review, we will respond by email.
      </p>

      <Card>
        <h2>Send an email if you are requesting an excusal</h2>
        <div className="sf-excuse-lists">
          <section>
            <h3>Things I will excuse</h3>
            <ul className="sf-list sf-list--tight">
              <li>Exams</li>
              <li>Required class events with proof</li>
            </ul>
          </section>
          <section>
            <h3>Things I will not excuse</h3>
            <ul className="sf-list sf-list--tight">
              <li>Social plans</li>
              <li>Studying, including during midterms</li>
            </ul>
          </section>
        </div>
        <details className="sf-disclosure">
          <summary>Excusal policy</summary>
          <div className="sf-disclosure-body">
            <p>
              A request to be excused from a scheduled shift. This{" "}
              <strong>must be made 72 hours in advance</strong> and be approved by a Unit Manager,
              or Head or Office. Excusals are granted for reasons such as academics or a scheduled
              flight and must include proper documentation (class schedule, flight itinerary etc).
            </p>
            <p>
              Academic conflicts include any exam or activity that directly impacts a student&apos;s
              grade in a course. All academic conflicts must include either a syllabus or email from
              a professor or TA to confirm the academic conflict time. If the conflict directly
              conflicts, your shift may be excused for 1 hour prior to the exam and 30 minutes after
              the exam. If the remainder of the shift is less than 2 hours, the whole shift may be
              excused.
            </p>
            <p>
              <strong>If your request is not eligible for excusal</strong>, you may instead find a
              trade/cover or take a UPD by calling the supervisor phone at least one hour before
              your shift, on the day of your shift.
            </p>
          </div>
        </details>
      </Card>

      <Notice tone="warning" role="note">
        <p>
          <strong>
            If you are requesting an excusal and your shift is not on the W2W trade board, I will
            automatically reject it.
          </strong>
        </p>
      </Notice>

      <WorkingTerm>
        <ChangeRequestsPanel initial={requests} initialBlocks={blocks} admin={admin} />
      </WorkingTerm>
    </StudentPage>
  );
}
