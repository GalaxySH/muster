import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadEvidence } from "@/lib/evidence/data";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { resolveStudentAccess } from "@/lib/groups/data";
import { loadReachableSteps } from "@/lib/flow/data";
import { CourseScheduleForm } from "@/components/evidence/CourseScheduleForm";
import { FormWindowBanner, NoGroupNotice, SubmittedLockBanner } from "@/components/FormWindowBanner";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { Page, PrimaryLink } from "@/components/ui";

export default async function CourseSchedulePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/course-schedule");

  const student = await findStudentByEmail(session.email);
  if (!student) {
    return (
      <Page>
        <h1>Course schedule &amp; activities</h1>
        <p>You&apos;re not on the current roster, so there&apos;s nothing to upload yet.</p>
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  const [evidence, drive, access, reachable] = await Promise.all([
    loadEvidence(student.email),
    getDriveGrantStatus(),
    resolveStudentAccess(student.email),
    loadReachableSteps(student.email),
  ]);

  if (access.access === "no-group") {
    return (
      <Page>
        <h1>Course schedule &amp; activities</h1>
        <NoGroupNotice />
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  const editable = access.canEdit;

  return (
    <Page>
      <AppHeader>
        <WizardSteps current="course-schedule" reachable={reachable} />
      </AppHeader>
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner state={access.state} opensAt={access.opensAt} closesAt={access.closesAt} />
      )}
      <CourseScheduleForm initial={evidence} driveConnected={drive.connected} editable={editable} />
      {editable && !evidence.submitted && (
        <p style={{ marginTop: 16 }}>
          {evidence.courseScheduleFileId ? (
            <PrimaryLink href="/availability">Continue</PrimaryLink>
          ) : (
            <span style={{ color: "#777", fontSize: 14 }}>
              Upload your course schedule to continue.
            </span>
          )}
        </p>
      )}
    </Page>
  );
}
