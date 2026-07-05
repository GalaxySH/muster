import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listGroups, getDefaultAutoAssignEnabled } from "@/lib/groups/data";
import { POSITIONS } from "@/lib/config/positions";
import { GroupWindowsTable } from "@/components/admin/GroupWindowsTable";
import { DefaultAssignmentPanel } from "@/components/admin/DefaultAssignmentPanel";
import { StudentAssigner } from "@/components/admin/StudentAssigner";
import { Page } from "@/components/ui";

/**
 * Admin: groups & form windows (PLAN §13). Define groups, schedule their
 * open/close windows, assign students (filtered picker or pasted emails), and
 * control the default-group auto-assignment sweep.
 */
export default async function AdminGroupsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/groups");
  if (!session.isAdmin) redirect("/me");

  const [groups, autoAssignEnabled] = await Promise.all([
    listGroups(),
    getDefaultAutoAssignEnabled(),
  ]);

  // Dates → epoch ms so the client can render them in the admin's local timezone.
  const groupViews = groups.map((g) => ({
    id: g.id,
    name: g.name,
    isDefault: g.isDefault,
    memberCount: g.memberCount,
    opensAtMs: g.opensAt ? g.opensAt.getTime() : null,
    closesAtMs: g.closesAt ? g.closesAt.getTime() : null,
    lockAfterSubmit: g.lockAfterSubmit,
  }));
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));
  const positions = POSITIONS.map((p) => ({ id: p.id, name: p.name }));

  return (
    <Page width="wide">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Groups &amp; form windows</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 720 }}>
        A student can only open the availability form if they&apos;re in a group whose response window is
        open. Students with no group are denied. Schedule a group&apos;s window below, then assign
        students. Enable default assignment to sweep all ungrouped employees into{" "}
        <strong>New Student</strong>.
      </p>

      <GroupWindowsTable groups={groupViews} />
      <DefaultAssignmentPanel initialEnabled={autoAssignEnabled} />
      <StudentAssigner groups={groupOptions} positions={positions} />
    </Page>
  );
}
