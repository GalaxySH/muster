import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { listChangeRequests } from "@/lib/changes/data";
import { ChangeRequestsPanel } from "@/components/changes/ChangeRequestsPanel";
import { AppHeader } from "@/components/AppHeader";
import { Page } from "@/components/ui";

/**
 * The always-available schedule change-request mini-flow (roadmap 3.1).
 * Deliberately outside the wizard and its window gates: any known student can
 * use it all semester, since it concerns their actual W2W schedule.
 */
export default async function ChangeRequestsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/change-requests");

  const student = await findStudentByEmail(session.email);
  if (!student) {
    return (
      <Page>
        <h1>Schedule change requests</h1>
        <p>You&apos;re not a known student, so there&apos;s nothing to request yet.</p>
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  const requests = await listChangeRequests(student.email);

  return (
    <Page>
      <AppHeader />
      <h1>Schedule change requests</h1>
      <p style={{ color: "#555" }}>
        Need a change to your work schedule during the semester? Pick the day and shift and
        describe what you need. The scheduler reviews requests and updates your schedule in
        WhenToWork; you can withdraw a request while it is still open.
      </p>
      <ChangeRequestsPanel initial={requests} />
    </Page>
  );
}
