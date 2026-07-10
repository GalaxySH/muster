import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { listChangeRequests } from "@/lib/changes/data";
import { ChangeRequestsPanel } from "@/components/changes/ChangeRequestsPanel";
import { AppHeader } from "@/components/AppHeader";
import { InfoCard, Page } from "@/components/ui";

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
      <InfoCard title="Send an email if you are requesting an excusal">
        <p style={{ color: "#555", marginTop: 0 }}>
          <strong>Excusal Policy:</strong> A request to be excused from a scheduled shift. This <strong>must be made 72 hours in advance</strong> and be approved by a Unit Manager, or Head or Office. Excusals are granted for reasons such as academics or a scheduled flight and must include proper documentation (class schedule, flight itinerary etc). Academic conflicts include any exam or activity that directly impacts a student&apos;s grade in a course. All academic conflicts must include either a syllabus or email from a professor or TA to confirm the academic conflict time. If the conflict directly conflicts, your shift may be excused for 1 hour prior to the exam and 30 minutes after the exam. If the remainder of the shift is less than 2 hours, the whole shift may be excused. <strong>If your request is not eligible for excusal</strong>, you may instead find a trade/cover or take a UPD by calling the supervisor phone at least one hour before your shift, on the day of your shift.
        </p>
        <div style={{ display: "flex", gap: "1rem 3rem", flexWrap: "wrap", margin: "0 0 0.5rem" }}>
          <section>
            <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>Things I will excuse</h3>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#555" }}>
              <li>Exams</li>
              <li>Required class events with proof</li>
            </ul>
          </section>
          <section>
            <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>Things I will not excuse</h3>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#555" }}>
              <li>Social plans</li>
              <li>Studying, including during midterms</li>
            </ul>
          </section>
        </div>
        <p style={{ color: "#555", marginBottom: 0 }}>
          <strong>If you are requesting an excusal and your shift is not on the W2W trade board, I will automatically reject it.</strong>
        </p>
      </InfoCard>
      <p style={{ color: "#555" }}>
        We will review requests for extenuating circumstances on a case by case basis. We cannot guarantee that your request can be accommodated. After review, we will respond by email.
      </p>
      <p style={{ color: "#555" }}>
        If your request is for a non-permanent change, put the specific date in the description.
      </p>
      <ChangeRequestsPanel initial={requests} />
    </Page>
  );
}
