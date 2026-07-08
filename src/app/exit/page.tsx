import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { FinishButton } from "@/components/FinishButton";
import { loadReachableSteps } from "@/lib/flow/data";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { Page } from "@/components/ui";

/**
 * Final wizard step (PLAN §13). Sets expectations (these are preferences, not a
 * schedule) and holds the one button that finalizes the submission.
 */
export default async function ExitPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/exit");
  const student = await findStudentByEmail(session.email);
  if (!student) redirect("/me");
  const reachable = await loadReachableSteps(session.email);

  return (
    <Page>
      <AppHeader>
        <WizardSteps reachable={reachable} />
      </AppHeader>
      <h1>Almost done</h1>

      <div
        role="note"
        style={{
          background: "#e7f0fb",
          border: "1px solid #b6d2f2",
          borderRadius: 8,
          padding: "1rem 1.2rem",
          fontSize: 15,
          margin: "1rem 0 1.4rem",
        }}
      >
        <strong>Reminder: This submits your schedule preferences, not your schedule.</strong>
        <p style={{ margin: "8px 0 0" }}>
          You haven&apos;t been scheduled yet. We will create your schedule once we have everyone&apos;s preferences.
        </p>
        <p style={{ margin: "8px 0 0" }}>
          Expect to see your schedule a week from semester start, or by the end of August. We will update you if there are any delays. We will send out emails notifying you when your schedule is ready.
        </p>
      </div>

      <p style={{ color: "#555", marginBottom: 16 }}>
        You can keep editing your responses until your form window closes.
      </p>

      <FinishButton />
    </Page>
  );
}
