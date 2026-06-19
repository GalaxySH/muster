import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadEvidence } from "@/lib/evidence/data";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { EvidenceForm } from "@/components/EvidenceForm";

export default async function EvidencePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/evidence");

  const student = await findStudentByEmail(session.email);
  if (!student) {
    return (
      <main style={{ padding: "2rem", maxWidth: 640 }}>
        <h1>Evidence &amp; excusals</h1>
        <p>You&apos;re not on the current roster, so there&apos;s nothing to upload yet.</p>
        <Link href="/me">← Back</Link>
      </main>
    );
  }

  const [evidence, drive] = await Promise.all([
    loadEvidence(student.email),
    getDriveGrantStatus(),
  ]);

  return (
    <main style={{ padding: "2rem" }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/availability">← Availability</Link>
      </p>
      <EvidenceForm initial={evidence} driveConnected={drive.connected} />
    </main>
  );
}
