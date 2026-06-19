import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadStudentForm } from "@/lib/availability/data";
import { buildGridModel } from "@/lib/availability/grid";
import { AvailabilityForm } from "@/components/AvailabilityForm";

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

  return (
    <main style={{ padding: "2rem" }}>
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
        initialStatus={form.submission?.status ?? null}
      />
    </main>
  );
}
