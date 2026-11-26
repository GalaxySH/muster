import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { listChangeRequestQueue } from "@/lib/changes/data";
import { changeRequestAdminPath } from "@/lib/changes/links";
import { ChangeRequestResolvedCheckbox } from "@/components/admin/ChangeRequestResolvedCheckbox";
import { ChangeStatusBadge } from "@/components/admin/ChangeStatusBadge";
import { ShowResolvedToggle } from "@/components/admin/ShowResolvedToggle";
import { ChangeRequestsEnabledToggle } from "@/components/admin/ChangeRequestsEnabledToggle";
import { changeRequestDayLabel } from "@/lib/domain/change-requests";
import { getChangeRequestsEnabled } from "@/lib/settings";
import { workingTermId } from "@/lib/terms/working";
import { AdminPage } from "@/components/admin/AdminPage";
import { ButtonLink, EmptyState, PageSettings, Panel } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Change requests" };

/**
 * The change-request queue (roadmap 3.1): the working term's open requests
 * oldest first, with an off-by-default toggle to mix resolved ones back in. A
 * row links to the student's response page, anchored to the request; the
 * checkbox resolves it in place (the row drops on refresh unless resolved rows
 * are shown).
 */
export default async function AdminChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ resolved?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/change-requests");
  if (!session.isAdmin) redirect("/me");

  const showResolved = (await searchParams).resolved === "1";
  const [requests, formEnabled] = await Promise.all([
    listChangeRequestQueue(await workingTermId(), showResolved),
    getChangeRequestsEnabled(),
  ]);

  return (
    <AdminPage
      title="Change requests"
      description={
        <>
          Unresolved schedule change request queue. Click a name to view the request in context on
          the student&apos;s response page. Use the checkbox to mark it resolved.
        </>
      }
      actions={<ButtonLink href="/change-requests">Request form</ButtonLink>}
    >
      <div className="ad-stack">
        <PageSettings summary={formEnabled ? "Request form on" : "Request form off"}>
          <ChangeRequestsEnabledToggle enabled={formEnabled} />
        </PageSettings>

        <Panel flush as="div">
          <div className="ad-toolbar">
            <ShowResolvedToggle showResolved={showResolved} />
            <div className="ad-toolbar-end">
              <span className="ad-ls-count">
                {requests.length} {showResolved ? "shown" : "unresolved"}
              </span>
            </div>
          </div>

          {requests.length === 0 ? (
            <EmptyState>
              {showResolved ? "No requests yet." : "No unresolved requests. 😁😁😁"}
            </EmptyState>
          ) : (
            <table className="ad-table ad-table--stack">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Shift</th>
                  <th scope="col">Comment</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className={r.status === "resolved" ? "ad-tr--success" : undefined}>
                    <td data-label="Student">
                      <Link
                        href={changeRequestAdminPath(r.studentEmail, r.id)}
                        className="ad-ls-name"
                      >
                        {r.studentName}
                      </Link>
                      <div className="ad-email">{r.studentEmail}</div>
                    </td>
                    <td data-label="Shift">
                      {changeRequestDayLabel(r.day)} · {r.shiftText} ·{" "}
                      {r.permanent ? "permanent" : "one time"}
                    </td>
                    <td data-label="Comment">
                      <div className="ad-prewrap ad-ls-comment">{r.comment}</div>
                    </td>
                    <td data-label="Requested" className="ad-nowrap ad-faint">
                      {fmtDay(r.createdAt)}
                    </td>
                    <td data-label="Resolved">
                      <span className="ad-ls-marks">
                        <ChangeRequestResolvedCheckbox id={r.id} status={r.status} />
                        {r.status === "resolved" && <ChangeStatusBadge status={r.status} />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}

const fmtDay = (d: Date) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
