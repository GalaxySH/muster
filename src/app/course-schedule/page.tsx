import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadEvidence } from "@/lib/evidence/data";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { resolveStudentAccess } from "@/lib/groups/data";
import { CourseScheduleForm } from "@/components/evidence/CourseScheduleForm";
import { FormWindowBanner, NoGroupNotice } from "@/components/FormWindowBanner";
import { WizardSteps } from "@/components/WizardSteps";

export default async function CourseSchedulePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/course-schedule");

  const student = await findStudentByEmail(session.email);
  if (!student) {
    return (
      <main style={{ padding: "2rem", maxWidth: 640 }}>
        <h1>Course schedule &amp; activities</h1>
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
        <h1>Course schedule &amp; activities</h1>
        <NoGroupNotice />
        <Link href="/me">← Back</Link>
      </main>
    );
  }

  const editable = access.state === "open";

  return (
    <main style={{ padding: "2rem" }}>
      <WizardSteps current="course-schedule" />
      <p style={{ marginBottom: 8 }}>
        <Link href="/me">← Your page</Link>
      </p>
      <FormWindowBanner state={access.state} opensAt={access.opensAt} closesAt={access.closesAt} />
      <CourseScheduleForm initial={evidence} driveConnected={drive.connected} editable={editable} />
      {editable && (
        <p style={{ marginTop: 16 }}>
          {evidence.courseScheduleFileId ? (
            <Link href="/availability" style={primaryLink}>
              Next: availability →
            </Link>
          ) : (
            <span style={{ color: "#777", fontSize: 14 }}>
              Upload your course schedule to continue.
            </span>
          )}
        </p>
      )}
    </main>
  );
}

const primaryLink: React.CSSProperties = {
  display: "inline-block",
  background: "#1a66cc",
  color: "#fff",
  borderRadius: 6,
  padding: "0.55rem 1.1rem",
  fontSize: 15,
  textDecoration: "none",
};
