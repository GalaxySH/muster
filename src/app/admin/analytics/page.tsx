import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/AdminPage";
import { Panel, Spark, Stat, StatStrip } from "@/components/admin/ui";
import { loadAnalyticsStudents } from "@/lib/admin/analytics";
import { buildAnalyticsView } from "@/lib/admin/analytics-view";

export const metadata: Metadata = { title: "Sign-in analytics" };

/** Counts move as people sign in; never serve a cached view. */
export const dynamic = "force-dynamic";

/**
 * Login analytics (linked from the admin hub): who on the roster has signed in,
 * who has not, and how recently. Fed by `students.last_seen_at`, stamped on any
 * authenticated activity. All derivation lives in the pure `analytics-view.ts`.
 */
export default async function AnalyticsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/analytics");
  if (!session.isAdmin) redirect("/me");

  const now = new Date();
  const view = buildAnalyticsView(await loadAnalyticsStudents(), now);
  const { funnel, recency } = view;

  return (
    <AdminPage
      title="Sign-in analytics"
      description={
        <>
          Who has logged in, out of {view.total} on the roster · as of {clock(now)}
        </>
      }
    >
      <div className="ad-stack">
        <StatStrip>
          <Stat
            label="Signed in"
            value={view.everSignedIn}
            of={`of ${view.total}`}
            sub={`${view.signedInPercent}% of the roster`}
          />
          <Stat
            label="Never signed in"
            value={view.neverSignedIn}
            sub="have not logged in yet"
            subTone={view.neverSignedIn > 0 ? "warning" : undefined}
          />
          <Stat label="Submitted" value={funnel.submitted} sub="finished the form" />
          <Stat label="Active today" value={recency.today} sub="signed in within 24 hours" />
        </StatStrip>

        <div className="ad-cols">
          {/* Where the roster sits on the way to a finished response. */}
          <Panel flush title="Progress to submitted">
            <table className="ad-table ad-table--middle">
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col" className="ad-num">
                    Students
                  </th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                <ShareRow
                  label="Never signed in"
                  count={funnel.neverSignedIn}
                  total={view.total}
                  fill="ad-bar-fill--rest"
                />
                <ShareRow
                  label="Signed in, no submission"
                  count={funnel.signedInNotSubmitted}
                  total={view.total}
                  fill="ad-bar-fill--draft"
                />
                <ShareRow label="Submitted" count={funnel.submitted} total={view.total} />
              </tbody>
            </table>
          </Panel>

          {/* How fresh the sign-ins are: a live roster vs. one that logged in once. */}
          <Panel flush title="Last active" aside={<>of the {view.everSignedIn} signed in</>}>
            <table className="ad-table ad-table--middle">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col" className="ad-num">
                    Students
                  </th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                <ShareRow label="Today" count={recency.today} total={view.everSignedIn} />
                <ShareRow label="This week" count={recency.week} total={view.everSignedIn} />
                <ShareRow label="This month" count={recency.month} total={view.everSignedIn} />
                <ShareRow
                  label="Over a month ago"
                  count={recency.dormant}
                  total={view.everSignedIn}
                />
              </tbody>
            </table>
          </Panel>
        </div>

        <Panel title="Recent activity">
          {view.perDay.every((d) => d.count === 0) ? (
            <p className="ad-help">No sign-in activity yet.</p>
          ) : (
            <Spark days={view.perDay} caption="last active per day" />
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}

/** One line of a breakdown: its count, then its share of the total as a bar. */
function ShareRow({
  label,
  count,
  total,
  fill,
}: {
  label: string;
  count: number;
  total: number;
  fill?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <tr>
      <td>{label}</td>
      <td className="ad-num">{count}</td>
      <td>
        <div className="ad-ls-share">
          <span className="ad-ls-share-figure">{pct}%</span>
          <div className="ad-bar">
            <div
              className={fill ? `ad-bar-fill ${fill}` : "ad-bar-fill"}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </td>
    </tr>
  );
}

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
