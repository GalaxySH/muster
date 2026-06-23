import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadReachableSteps } from "@/lib/flow/data";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { PrimaryLink } from "@/components/ui";
import { CONTACT_EMAIL } from "@/components/evidence/shared";
import { defaultTravelCutoff } from "@/lib/domain/travel";

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

  return (
    <main style={{ padding: "2rem", maxWidth: 680 }}>
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
            Mark <strong>every</strong> shift you&apos;d be willing to work. These are preferences,
            not your final schedule.
          </li>
          <li>
            Picking more than your required hours gives you a better chance of getting your preferred shifts. You can change your selections until your form window closes.
          </li>
          <li>
            You must reach your position&apos;s <strong>minimum weekly hours</strong> (10h; Shift
            Leads 15h) across the shifts you select.
          </li>
          <li>
            Weekends run on an <strong>A/B rotation</strong> (a weekend shift every other weekend),
            unless you opt into working every weekend. You are required to work a weekend shift. You pick the shift, we pick A/B based on operational needs.
          </li>
          <li>
            Travel is only excused if you add it <strong>before {defaultTravelCutoff(new Date()).toLocaleDateString()}</strong>. We will not excuse <strong>any</strong> travel after that date.
          </li>
          <li>
            If you have questions, contact your scheduler (<strong>{CONTACT_EMAIL}</strong>).
          </li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>What we need from you</h2>
        <ol style={list}>
          <li>Upload your course schedule (required) and any mandatory regularly occurring academic activities.</li>
          <li>Set your recurring weekly availability and desired hours.</li>
          <li>Submit any planned travel to be excused.</li>
          <li>Review and submit.</li>
        </ol>
      </section>

      <p style={{ marginTop: 20 }}>
        <PrimaryLink href="/course-schedule">Continue</PrimaryLink>
      </p>
    </main>
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
