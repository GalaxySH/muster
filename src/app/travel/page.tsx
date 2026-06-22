import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadEvidence } from "@/lib/evidence/data";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { resolveStudentAccess } from "@/lib/groups/data";
import { TravelForm } from "@/components/evidence/TravelForm";
import { TravelContinue } from "@/components/evidence/TravelContinue";
import { FormWindowBanner, NoGroupNotice } from "@/components/FormWindowBanner";
import { WizardSteps } from "@/components/WizardSteps";

export default async function TravelPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/travel");

  const student = await findStudentByEmail(session.email);
  if (!student) {
    return (
      <main style={{ padding: "2rem", maxWidth: 640 }}>
        <h1>Travel excusals</h1>
        <p>You&apos;re not on the current roster, so there&apos;s nothing to upload yet.</p>
        <Link href="/me">← Back</Link>
      </main>
    );
  }

  const [evidence, drive, access] = await Promise.all([
    loadEvidence(student.email),
    getDriveGrantStatus(),
    resolveStudentAccess(student.email),
  ]);

  if (access.access === "no-group") {
    return (
      <main style={{ padding: "2rem", maxWidth: 640 }}>
        <h1>Travel excusals</h1>
        <NoGroupNotice />
        <Link href="/me">← Back</Link>
      </main>
    );
  }

  const editable = access.state === "open";

  return (
    <main style={{ padding: "2rem" }}>
      <WizardSteps current="travel" />
      <p style={{ marginBottom: 8 }}>
        <Link href="/me">← Your page</Link>
        <span style={{ color: "#ccc", margin: "0 8px" }}>·</span>
        <Link href="/availability">← Availability</Link>
      </p>
      <FormWindowBanner state={access.state} opensAt={access.opensAt} closesAt={access.closesAt} />
      <TravelForm initial={evidence} driveConnected={drive.connected} editable={editable} />
      {editable ? (
        <TravelContinue />
      ) : (
        <p style={{ marginTop: 16 }}>
          <Link href="/me">← Your page</Link>
        </p>
      )}
    </main>
  );
}
