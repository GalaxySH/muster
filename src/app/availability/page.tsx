import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadStudentForm } from "@/lib/availability/data";
import { buildGridModel } from "@/lib/availability/grid";
import { resolveStudentAccess } from "@/lib/groups/data";
import { AvailabilityForm } from "@/components/AvailabilityForm";
import { FormWindowBanner, NoGroupNotice } from "@/components/FormWindowBanner";

export default async function AvailabilityPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/availability");

  const form = await loadStudentForm(session.email);

  if (!form) {
    return (
      <main style={{ padding: "2rem", maxWidth: 640 }}>
        <h1>Availability</h1>
        <p>You&apos;re not on the current roster, so there&apos;s no form to fill out yet.</p>
        <Link href="/me">← Back</Link>
      </main>
    );
  }

  // Membership gate (PLAN §13): no group ⇒ no access at all.
  const access = await resolveStudentAccess(form.student.email);
  if (access.access === "no-group") {
    return (
      <main style={{ padding: "2rem", maxWidth: 640 }}>
        <h1>Availability</h1>
        <NoGroupNotice />
        <Link href="/me">← Back</Link>
      </main>
    );
  }

  if (!form.position) {
    return (
      <main style={{ padding: "2rem", maxWidth: 640 }}>
        <h1>Availability</h1>
        <p>
          Your position isn&apos;t set yet. Choosing your position during onboarding is coming soon;
          ask your supervisor if this looks wrong.
        </p>
        <Link href="/me">← Back</Link>
      </main>
    );
  }

  // Window gate (PLAN §13): only an open window permits edits.
  const editable = access.state === "open";

  return (
    <main style={{ padding: "2rem" }}>
      <FormWindowBanner state={access.state} opensAt={access.opensAt} closesAt={access.closesAt} />
      <p style={{ marginBottom: 12 }}>
        <Link href="/evidence">Upload course schedule &amp; excusal proof →</Link>
      </p>
      <AvailabilityForm
        key={form.position.id}
        position={form.position}
        blocks={form.blocks}
        gridModel={buildGridModel(form.blocks)}
        international={form.student.international}
        initialSelection={form.selection}
        initialAutoAssigned={form.autoAssigned}
        initialEveryWeekendOptIn={form.submission?.everyWeekendOptIn ?? false}
        initialDesiredHours={form.submission?.desiredHours ?? null}
        initialNotes={form.submission?.studentNotes ?? ""}
        initialStatus={form.submission?.status ?? null}
        editable={editable}
      />
    </main>
  );
}
