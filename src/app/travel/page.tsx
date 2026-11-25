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
import { nextHref } from "@/lib/flow/steps";
import { TravelForm } from "@/components/evidence/TravelForm";
import { contactLabel } from "@/lib/env";
import { TravelContinue } from "@/components/evidence/TravelContinue";
import { OnBehalfBanner } from "@/components/evidence/shared";
import {
  FormWindowBanner,
  NoGroupNotice,
  SubmittedLockBanner,
} from "@/components/FormWindowBanner";
import { StudentPage } from "@/components/student/StudentPage";
import { StudentDeadEnd } from "@/components/student/StudentDeadEnd";
import { Notice } from "@/components/student/ui";
import { getTravelCutoff, getLateTravelPolicy } from "@/lib/settings";
import { isTravelExcused } from "@/lib/domain/travel";
import { getPositionReturnDate } from "@/lib/positions/data";

export const metadata: Metadata = { title: "Travel" };

/**
 * `isoDate` is the stored "YYYY-MM-DD"; formatted without a Date object so no
 * timezone applies. Null (unset on /admin/positions, or malformed) means no
 * return date to show: the card is left off /travel entirely rather than
 * guessing one.
 */
function formatReturnDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const [, month, day] = /^\d{4}-(\d{2})-(\d{2})$/.exec(isoDate) ?? [];
  return month && day ? `${Number(month)}/${Number(day)}` : null;
}

export default async function TravelPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/travel");

  // An admin can fill a student's travel in for them (?student=email, linked
  // from the per-student admin page). That path loads the target's entries and
  // skips the group/window gates. The travel cutoff still applies (PLAN §8).
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
      <StudentDeadEnd title="Travel">
        <Notice tone="warning">
          <p>You&apos;re not on the current roster, so there&apos;s nothing to upload yet.</p>
        </Notice>
      </StudentDeadEnd>
    );
  }

  const now = new Date();
  const [evidence, drive, { cutoff }, policy, returnDateRow] = await Promise.all([
    loadEvidence(student.email, termId),
    getDriveGrantStatus(),
    getTravelCutoff(termId),
    getLateTravelPolicy(termId),
    getPositionReturnDate(student.positionId),
  ]);
  const pastCutoff = !isTravelExcused(now, cutoff);
  const lateAccepted = policy === "accept-and-flag";
  const returnDate = formatReturnDate(returnDateRow);

  if (onBehalf) {
    return (
      <StudentPage>
        <h1>Travel</h1>
        <OnBehalfBanner displayName={onBehalf.displayName} email={onBehalf.email} />
        <WorkingTerm>
          <TravelForm
            initial={evidence}
            driveConnected={drive.connected}
            cutoffMs={cutoff.getTime()}
            pastCutoff={pastCutoff}
            lateAccepted={lateAccepted}
            onBehalfOf={onBehalf.email}
            returnDate={returnDate}
            contactEmail={contactLabel}
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
      <StudentDeadEnd title="Travel">
        <NoGroupNotice />
      </StudentDeadEnd>
    );
  }

  const editable = access.canEdit;

  return (
    <StudentPage nav={nav} current="travel">
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner
          state={access.state}
          opensAt={access.opensAt}
          closesAt={access.closesAt}
        />
      )}
      <h1>Travel</h1>
      <TravelForm
        initial={evidence}
        driveConnected={drive.connected}
        editable={editable}
        cutoffMs={cutoff.getTime()}
        pastCutoff={pastCutoff}
        lateAccepted={lateAccepted}
        returnDate={returnDate}
        contactEmail={contactLabel}
      />
      {editable && !evidence.submitted && (
        <TravelContinue nextHref={nextHref("travel", nav.steps)} />
      )}
    </StudentPage>
  );
}
