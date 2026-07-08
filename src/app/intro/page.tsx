import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadReachableSteps } from "@/lib/flow/data";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { Page, PrimaryLink } from "@/components/ui";
import { CONTACT_EMAIL } from "@/components/evidence/shared";
import { getTravelCutoff } from "@/lib/settings";

/**
 * Orientation step (PLAN §4). Concise scheduling-policy reminders + what the
 * student is about to fill out, then "Next" into the first data step. Reached
 * from the /me confirm-your-info button.
 */
export default async function IntroPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/intro");
  const student = await findStudentByEmail(session.email);
  if (!student) redirect("/me");
  const reachable = await loadReachableSteps(session.email);
  const { cutoff } = await getTravelCutoff(new Date());

  return (
    <Page>
      <AppHeader>
        <WizardSteps reachable={reachable} />
      </AppHeader>
      <h1>Before you start</h1>
      <p style={{ color: "#555" }}>
        This form collects your <strong>availability and preferences</strong>. A human
        uses them to create your schedule. You are <strong>not</strong> scheduling yourself.
      </p>

      <section style={card}>
        <h2 style={h2}>A few things to know</h2>
        <ul style={list}>
          <li>
            Scheduling is based primarily on your course schedule, operational needs, and availability, in that order. We do our best to accommodate your preferences, but we cannot guarantee them.
          </li>
          <li>
            You do <strong>not</strong> need to fill out availability preferences in
            WhenToWork — this form replaces that step.
          </li>
          <li>
            You must select your position&apos;s <strong>minimum weekly hours</strong> (10h; Shift
            Leads 15h).
          </li>
          <li>
            Mark <strong>every</strong> shift you&apos;d be willing to work. These are preferences,
            not your final schedule.
          </li>
          <li>
            Weekly preferences that total more than your required hours give you a better chance of getting your preferred shifts. You can change your selections until your form window closes.
          </li>
          <li>
          You are required to work a weekend shift. Weekends run on an <strong>A/B rotation</strong> (a weekend shift every other weekend), unless you opt into working every weekend. You pick the shift time, we pick which of A/B based on operational needs.
          </li>
          <li>
            Travel during the semester is only excused if you add it <strong>before {cutoff.toLocaleDateString()}</strong>. The form does not accept <strong>any</strong> travel added after that date.
          </li>
          <li>
            If your availability changes throughout the semester, contact us by email or come into the office. We will always accept excusal requests for exams throughout the semester, and we will review requests for extenuating circumstances on a case by case basis.
          </li>
          <li>
            If you have questions, contact the scheduler (<strong>{CONTACT_EMAIL}</strong>).
          </li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>What we need from you</h2>
        <ol style={list}>
          <li>Upload proof of your course schedule (required) and any mandatory regularly occurring academic activities.</li>
          <li>Set your recurring weekly availability and desired hours (this will apply to every week in the semester).</li>
          <li>Submit any planned travel to be excused.</li>
          <li>Review and submit.</li>
        </ol>
      </section>

      <p style={{ marginTop: 20 }}>
        <PrimaryLink href="/course-schedule">Continue</PrimaryLink>
      </p>
    </Page>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
  marginTop: "1.2rem",
};
const h2: React.CSSProperties = { fontSize: 16, marginTop: 0 };
const list: React.CSSProperties = { margin: 0, paddingLeft: "1.2rem", display: "grid", gap: 6, fontSize: 15 };
