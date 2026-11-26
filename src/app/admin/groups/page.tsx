import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { listGroups, getDefaultAutoAssignEnabled } from "@/lib/groups/data";
import { positionOptions } from "@/lib/positions/data";
import { workingTermId } from "@/lib/terms/working";
import { GroupWindowsTable } from "@/components/admin/GroupWindowsTable";
import { DefaultAssignmentPanel } from "@/components/admin/DefaultAssignmentPanel";
import { StudentAssigner } from "@/components/admin/StudentAssigner";
import { PopularShiftsPanel } from "@/components/admin/PopularShiftsPanel";
import { AdminPage } from "@/components/admin/AdminPage";
import { Disclosure, PageSettings } from "@/components/admin/ui";
import { getHighDemandMarksEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "Groups and windows" };

/**
 * Admin: groups & form windows (PLAN §13). Define groups, schedule their
 * open/close windows, assign students (filtered picker or pasted emails), and
 * control the default-group auto-assignment sweep.
 */
export default async function AdminGroupsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/groups");
  if (!session.isAdmin) redirect("/me");

  const [groups, autoAssignEnabled, highDemandMarks, positions] = await Promise.all([
    listGroups(),
    getDefaultAutoAssignEnabled(),
    getHighDemandMarksEnabled(),
    positionOptions(await workingTermId()),
  ]);

  // Dates → epoch ms so the client can render them in the admin's local timezone.
  const groupViews = groups.map((g) => ({
    id: g.id,
    name: g.name,
    isDefault: g.isDefault,
    isTest: g.isTest,
    memberCount: g.memberCount,
    memberEmails: g.memberEmails,
    opensAtMs: g.opensAt ? g.opensAt.getTime() : null,
    closesAtMs: g.closesAt ? g.closesAt.getTime() : null,
    lockAfterSubmit: g.lockAfterSubmit,
  }));
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <AdminPage title="Groups and windows">
      <div className="ad-stack">
        <Disclosure title="About this page">
          <p className="ad-su-prose">
            A student can only open the availability form if they&apos;re in a group whose response
            window is open. Students with no group are denied. Schedule a group&apos;s window below,
            then assign students. Enable default assignment to sweep all ungrouped employees into
            the group marked <strong>default</strong>.
          </p>
        </Disclosure>

        <PageSettings
          summary={`Popular shift marks ${highDemandMarks ? "shown" : "hidden"} · Default assignment ${autoAssignEnabled ? "on" : "off"}`}
        >
          <PopularShiftsPanel initialEnabled={highDemandMarks} />
          <DefaultAssignmentPanel initialEnabled={autoAssignEnabled} />
        </PageSettings>

        <GroupWindowsTable groups={groupViews} />
        <StudentAssigner groups={groupOptions} positions={positions} />
      </div>
    </AdminPage>
  );
}
