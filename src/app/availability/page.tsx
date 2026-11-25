import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { loadStudentForm, loadHighDemandCells } from "@/lib/availability/data";
import { buildGridModel } from "@/lib/availability/grid";
import { resolveStudentAccess } from "@/lib/groups/data";
import { currentTermId } from "@/lib/terms/working";
import { getHighDemandMarksEnabled } from "@/lib/settings";
import { loadWizardNav } from "@/lib/flow/data";
import { AvailabilityForm } from "@/components/AvailabilityForm";
import {
  FormWindowBanner,
  NoGroupNotice,
  SubmittedLockBanner,
} from "@/components/FormWindowBanner";
import { StudentPage } from "@/components/student/StudentPage";
import { StudentDeadEnd } from "@/components/student/StudentDeadEnd";
import { Notice } from "@/components/student/ui";

export const metadata: Metadata = { title: "Availability" };

export default async function AvailabilityPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/availability");

  const termId = await currentTermId();
  const form = await loadStudentForm(session.email, termId);

  if (!form) {
    return (
      <StudentDeadEnd title="Availability">
        <Notice tone="warning">
          <p>You&apos;re not on the current roster, so there&apos;s no form to fill out yet.</p>
        </Notice>
      </StudentDeadEnd>
    );
  }

  // Membership gate (PLAN §13): no group ⇒ no access at all.
  const access = await resolveStudentAccess(form.student.email, termId);
  if (access.access === "no-group") {
    return (
      <StudentDeadEnd title="Availability">
        <NoGroupNotice />
      </StudentDeadEnd>
    );
  }

  if (!form.position) {
    return (
      <StudentDeadEnd title="Availability">
        <Notice tone="warning">
          <p>
            Your position isn&apos;t set yet. Choosing your position during onboarding is coming
            soon; ask your supervisor if this looks wrong.
          </p>
        </Notice>
      </StudentDeadEnd>
    );
  }

  // Window gate (PLAN §13): only an open window permits edits, and if the group
  // locks after submit, an already-submitted student is read-only too.
  const editable = access.canEdit;
  // The busiest-shift marks are admin-switchable (/admin/groups). Off, the set
  // is empty, which drops the flame marks and their legend from the grid.
  const [nav, marksEnabled] = await Promise.all([
    loadWizardNav(form.student.email, termId),
    getHighDemandMarksEnabled(),
  ]);
  const highDemand = marksEnabled
    ? await loadHighDemandCells(form.position.id, termId)
    : new Set<string>();

  return (
    <StudentPage width="wide" nav={nav} current="availability">
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner
          state={access.state}
          opensAt={access.opensAt}
          closesAt={access.closesAt}
        />
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
    </StudentPage>
  );
}
