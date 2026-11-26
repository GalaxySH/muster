import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadUpcomingTravel } from "@/lib/admin/data";
import { UpcomingTravelRow } from "@/components/admin/UpcomingTravelRow";
import { EmptyState, PageSettings, Panel, formatDayLabel } from "@/components/admin/ui";
import { AdminPage } from "@/components/admin/AdminPage";

export const metadata: Metadata = { title: "Upcoming travel" };

/**
 * Upcoming-travel tab (roadmap 2.3): on-roster students traveling now through the
 * next three weeks, grouped by week so the scheduler can plan around them. Each
 * entry carries a "resolved" checkbox the scheduler ticks once the trip is
 * accounted for; the hub warns about unresolved trips starting within two days.
 */
export default async function AdminTravelPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/travel");
  if (!session.isAdmin) redirect("/me");

  const weeks = await loadUpcomingTravel();
  const total = weeks.reduce((n, w) => n + w.entries.length, 0);

  return (
    <AdminPage
      title="Upcoming travel"
      description="Travel for the next three weeks. Mark each one resolved once you have worked it into the schedule."
    >
      <div className="ad-stack">
        {/* The late-travel toggles live with the semester. */}
        <PageSettings summary="On the Semester page">
          <p className="ad-ls-settings-link">
            <Link href="/admin/terms">Travel settings</Link>
          </p>
        </PageSettings>

        <Panel flush as="div">
          <div className="ad-toolbar">
            <div className="ad-toolbar-end">
              <span className="ad-ls-count">
                {total} {total === 1 ? "trip" : "trips"}
              </span>
            </div>
          </div>
          {weeks.length === 0 ? (
            <EmptyState>No travel in the next three weeks.</EmptyState>
          ) : (
            <table className="ad-table ad-table--stack ad-table--middle">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Position</th>
                  <th scope="col">Note</th>
                  <th scope="col">Proof</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Resolved</th>
                </tr>
              </thead>
              {weeks.map((w) => (
                <tbody key={w.weekStart}>
                  <tr className="ad-tr-group ad-ls-group">
                    <th scope="colgroup" colSpan={6}>
                      Week of {formatDayLabel(w.weekStart)}
                    </th>
                  </tr>
                  {w.entries.map((entry) => (
                    <UpcomingTravelRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
