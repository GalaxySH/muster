import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadEvidence } from "@/lib/evidence/data";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { resolveStudentAccess } from "@/lib/groups/data";
import { loadReachableSteps } from "@/lib/flow/data";
import { TravelForm } from "@/components/evidence/TravelForm";
import { TravelContinue } from "@/components/evidence/TravelContinue";
import { FormWindowBanner, NoGroupNotice, SubmittedLockBanner } from "@/components/FormWindowBanner";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { Page } from "@/components/ui";
import { getTravelCutoff } from "@/lib/settings";
import { decideTravelSubmission } from "@/lib/domain/travel";

export default async function TravelPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/travel");

  const student = await findStudentByEmail(session.email);
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
  const [evidence, drive, access, reachable, { cutoff }] = await Promise.all([
    loadEvidence(student.email),
    getDriveGrantStatus(),
    resolveStudentAccess(student.email),
    loadReachableSteps(student.email),
    getTravelCutoff(now),
  ]);
  const canAddTravel = decideTravelSubmission(now, cutoff).allowed;

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
        <WizardSteps current="travel" reachable={reachable} />
      </AppHeader>
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner state={access.state} opensAt={access.opensAt} closesAt={access.closesAt} />
      )}
      <TravelForm
        initial={evidence}
        driveConnected={drive.connected}
        editable={editable}
        cutoffMs={cutoff.getTime()}
        canAddTravel={canAddTravel}
      />
      {editable && !evidence.submitted && <TravelContinue />}
    </Page>
  );
}
