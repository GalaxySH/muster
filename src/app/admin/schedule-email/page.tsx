import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listGroups } from "@/lib/groups/data";
import { loadScheduleEmailPreview } from "@/lib/admin/data";
import { ScheduleEmailPanel } from "@/components/admin/ScheduleEmailPanel";
import { Page } from "@/components/ui";

/**
 * Batch schedule-ready email (roadmap 2.4): pick a group, preview the recipients
 * (on-roster + submitted + marked scheduled, not yet emailed), and send once each.
 */
export default async function ScheduleEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/schedule-email");
  if (!session.isAdmin) redirect("/me");

  const sp = await searchParams;
  const groups = await listGroups();
  const selected = sp.group && groups.some((g) => g.id === sp.group) ? sp.group : "";
  const preview = selected ? await loadScheduleEmailPreview(selected) : null;

  return (
    <Page width="wide">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Batch Scheduling Email</h1>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        Tell students their schedule has been created. Only students marked scheduled are
        emailed, and each one is emailed just once.
      </p>
      <ScheduleEmailPanel
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        selectedGroup={selected}
        preview={preview}
      />
    </Page>
  );
}
