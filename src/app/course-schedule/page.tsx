import type { Metadata } from "next";
import { WorkingTerm } from "@/components/WorkingTerm";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadEvidence } from "@/lib/evidence/data";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { resolveStudentAccess } from "@/lib/groups/data";
import { currentTermId, workingTermId } from "@/lib/terms/working";
import { loadWizardNav } from "@/lib/flow/data";
import { CourseScheduleForm } from "@/components/evidence/CourseScheduleForm";
import { OnBehalfBanner } from "@/components/evidence/shared";
import {
  FormWindowBanner,
  NoGroupNotice,
  SubmittedLockBanner,
} from "@/components/FormWindowBanner";
import { StudentPage } from "@/components/student/StudentPage";
import { StudentDeadEnd } from "@/components/student/StudentDeadEnd";
import { Notice, StepActions } from "@/components/student/ui";

export const metadata: Metadata = { title: "Course schedule" };

export default async function CourseSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/course-schedule");

  // An admin can fill a student's details in for them (?student=email, linked
  // from the per-student admin page). That path loads the target's evidence and
  // skips the group/window gates: the admin is the authority, not the window.
  const { student: studentParam } = await searchParams;
  // Their own page is the current semester's. For someone else it is the one
  // the admin is working in.
  let termId = await currentTermId();
  let onBehalf: Awaited<ReturnType<typeof findStudentByEmail>> = null;
  if (session.isAdmin && studentParam) {
    const selected = await workingTermId();
    onBehalf = await findStudentByEmail(studentParam, selected);
    if (onBehalf) termId = selected;
  }
  const student = onBehalf ?? (await findStudentByEmail(session.email, termId));
  if (!student) {
    return (
      <StudentDeadEnd title="Course schedule">
        <Notice tone="warning">
          <p>You&apos;re not on the current roster, so there&apos;s nothing to upload yet.</p>
        </Notice>
      </StudentDeadEnd>
    );
  }

  const [evidence, drive] = await Promise.all([
    loadEvidence(student.email, termId),
    getDriveGrantStatus(),
  ]);

  if (onBehalf) {
    return (
      <StudentPage>
        <h1>Course schedule</h1>
        <OnBehalfBanner displayName={onBehalf.displayName} email={onBehalf.email} />
        <WorkingTerm>
          <CourseScheduleForm
            initial={evidence}
            driveConnected={drive.connected}
            onBehalfOf={onBehalf.email}
          />
        </WorkingTerm>
      </StudentPage>
    );
  }

  const [access, nav] = await Promise.all([
    resolveStudentAccess(student.email, termId),
    loadWizardNav(student.email, termId),
  ]);

  if (access.access === "no-group") {
    return (
      <StudentDeadEnd title="Course schedule">
        <NoGroupNotice />
      </StudentDeadEnd>
    );
  }

  const editable = access.canEdit;
  const uploaded = Boolean(evidence.courseScheduleFileId);

  return (
    <StudentPage nav={nav} current="course-schedule">
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner
          state={access.state}
          opensAt={access.opensAt}
          closesAt={access.closesAt}
        />
      )}
      <h1>Course schedule</h1>
      <CourseScheduleForm initial={evidence} driveConnected={drive.connected} editable={editable} />
      {editable && !evidence.submitted && (
        <StepActions
          backHref="/intro"
          nextHref="/availability"
          blockedReason={uploaded ? undefined : "Upload your course schedule to continue."}
        />
      )}
    </StudentPage>
  );
}
