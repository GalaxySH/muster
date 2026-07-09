import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadStudentForm, loadHighDemandCells } from "@/lib/availability/data";
import { buildGridModel } from "@/lib/availability/grid";
import { resolveStudentAccess } from "@/lib/groups/data";
import { loadWizardNav } from "@/lib/flow/data";
import { AvailabilityForm } from "@/components/AvailabilityForm";
import { FormWindowBanner, NoGroupNotice, SubmittedLockBanner } from "@/components/FormWindowBanner";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { Page } from "@/components/ui";

export default async function AvailabilityPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/availability");

  const form = await loadStudentForm(session.email);

  if (!form) {
    return (
      <Page>
        <h1>Availability</h1>
        <p>You&apos;re not on the current roster, so there&apos;s no form to fill out yet.</p>
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  // Membership gate (PLAN §13): no group ⇒ no access at all.
  const access = await resolveStudentAccess(form.student.email);
  if (access.access === "no-group") {
    return (
      <Page>
        <h1>Availability</h1>
        <NoGroupNotice />
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  if (!form.position) {
    return (
      <Page>
        <h1>Availability</h1>
        <p>
          Your position isn&apos;t set yet. Choosing your position during onboarding is coming soon;
          ask your supervisor if this looks wrong.
        </p>
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  // Window gate (PLAN §13): only an open window permits edits, and if the group
  // locks after submit, an already-submitted student is read-only too.
  const editable = access.canEdit;
  const [nav, highDemand] = await Promise.all([
    loadWizardNav(form.student.email),
    loadHighDemandCells(form.position.id),
  ]);

  return (
    <Page width="wide">
      <AppHeader>
        <WizardSteps steps={nav.steps} current="availability" reachable={nav.reachable} />
      </AppHeader>
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner state={access.state} opensAt={access.opensAt} closesAt={access.closesAt} />
      )}
      <AvailabilityForm
        key={form.position.id}
        position={form.position}
        blocks={form.blocks}
        gridModel={buildGridModel(form.blocks, highDemand)}
        international={form.student.international}
        initialSelection={form.selection}
        initialAutoAssigned={form.autoAssigned}
        initialEveryWeekendOptIn={form.submission?.everyWeekendOptIn ?? false}
        initialDesiredHours={form.submission?.desiredHours ?? null}
        initialNotes={form.submission?.studentNotes ?? ""}
        initialStatus={form.submission?.status ?? null}
        editable={editable}
      />
    </Page>
  );
}
