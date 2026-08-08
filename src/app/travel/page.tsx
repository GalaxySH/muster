import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadEvidence } from "@/lib/evidence/data";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { resolveStudentAccess } from "@/lib/groups/data";
import { loadWizardNav } from "@/lib/flow/data";
import { nextHref } from "@/lib/flow/steps";
import { TravelForm } from "@/components/evidence/TravelForm";
import { TravelContinue } from "@/components/evidence/TravelContinue";
import { OnBehalfBanner } from "@/components/evidence/shared";
import {
  FormWindowBanner,
  NoGroupNotice,
  SubmittedLockBanner,
} from "@/components/FormWindowBanner";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { Page } from "@/components/ui";
import { getTravelCutoff, getLateTravelPolicy } from "@/lib/settings";
import { isTravelExcused } from "@/lib/domain/travel";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";

function returnDateFor(positionId: string | null) {
  return positionId === SHIFT_LEAD_POSITION_ID ? "8/17" : "8/27";
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
  const onBehalf = session.isAdmin && studentParam ? await findStudentByEmail(studentParam) : null;
  const student = onBehalf ?? (await findStudentByEmail(session.email));
  if (!student) {
    return (
      <Page>
        <h1>Travel excusals</h1>
        <p>You&apos;re not on the current roster, so there&apos;s nothing to upload yet.</p>
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  const now = new Date();
  const [evidence, drive, { cutoff }, policy] = await Promise.all([
    loadEvidence(student.email),
    getDriveGrantStatus(),
    getTravelCutoff(now),
    getLateTravelPolicy(),
  ]);
  const pastCutoff = !isTravelExcused(now, cutoff);
  const lateAccepted = policy === "accept-and-flag";

  if (onBehalf) {
    return (
      <Page>
        <AppHeader />
        <OnBehalfBanner displayName={onBehalf.displayName} email={onBehalf.email} />
        <TravelForm
          initial={evidence}
          driveConnected={drive.connected}
          cutoffMs={cutoff.getTime()}
          pastCutoff={pastCutoff}
          lateAccepted={lateAccepted}
          onBehalfOf={onBehalf.email}
          returnDate={returnDateFor(onBehalf.positionId)}
        />
      </Page>
    );
  }

  const [access, nav] = await Promise.all([
    resolveStudentAccess(student.email),
    loadWizardNav(student.email),
  ]);

  if (access.access === "no-group") {
    return (
      <Page>
        <h1>Travel excusals</h1>
        <NoGroupNotice />
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  const editable = access.canEdit;

  return (
    <Page>
      <AppHeader>
        <WizardSteps steps={nav.steps} current="travel" reachable={nav.reachable} />
      </AppHeader>
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner
          state={access.state}
          opensAt={access.opensAt}
          closesAt={access.closesAt}
        />
      )}
      <TravelForm
        initial={evidence}
        driveConnected={drive.connected}
        editable={editable}
        cutoffMs={cutoff.getTime()}
        pastCutoff={pastCutoff}
        lateAccepted={lateAccepted}
        returnDate={returnDateFor(student.positionId)}
      />
      {editable && !evidence.submitted && (
        <TravelContinue nextHref={nextHref("travel", nav.steps)} />
      )}
    </Page>
  );
}
