import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { listNonResponses, type RosterPerson } from "@/lib/admin/data";
import { CopyEmailsButton } from "@/components/admin/CopyEmailsButton";
import { AdminPage } from "@/components/admin/AdminPage";
import { Panel, Pill, Status } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Missing responses" };

/**
 * Non-response tracking (PLAN §10): who on the roster still owes a submission,
 * split into never-started vs. draft-only, plus off-roster responders to note.
 */
export default async function NonResponsesPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/non-responses");
  if (!session.isAdmin) redirect("/me");

  const report = await listNonResponses();
  const outstandingPeople = [...report.noResponse, ...report.draftOnly];
  const outstanding = outstandingPeople.length;
  const outstandingEmails = outstandingPeople.map((p) => p.email);
  const pct =
    report.rosterTotal > 0 ? Math.round((report.respondedCount / report.rosterTotal) * 100) : 0;

  return (
    <AdminPage title="Missing responses">
      <Panel flush as="div">
        <div className="ad-toolbar">
          <span>
            <strong>{report.respondedCount}</strong> of <strong>{report.rosterTotal}</strong> roster
            students submitted ({pct}%). <strong>{outstanding}</strong> outstanding.
          </span>
          {outstanding > 0 && (
            <div className="ad-toolbar-end">
              <CopyEmailsButton
                emails={outstandingEmails}
                label={`Copy ${outstanding} outstanding email${outstanding === 1 ? "" : "s"}`}
              />
            </div>
          )}
        </div>
        <table className="ad-table ad-table--stack ad-table--middle">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Position</th>
            </tr>
          </thead>
          <Group
            title={`No response (${report.noResponse.length})`}
            hint="On the roster, hasn't started a submission."
            people={report.noResponse}
          />
          <Group
            title={`Started, not submitted (${report.draftOnly.length})`}
            hint="Has a draft but hasn't submitted yet."
            people={report.draftOnly}
          />
          {report.offRoster.length > 0 && (
            <Group
              copy={false}
              title={`Off-roster responders (${report.offRoster.length})`}
              hint="Submitted but not on the current roster. Position and international status may be self-reported."
              people={report.offRoster}
            />
          )}
        </table>
      </Panel>
    </AdminPage>
  );
}

/**
 * One bucket: a heading row, then a row for each person. The heading has a Copy
 * emails button when the bucket has people (never for the off-roster bucket).
 */
function Group({
  title,
  hint,
  people,
  copy = true,
}: {
  title: string;
  hint: string;
  people: RosterPerson[];
  copy?: boolean;
}) {
  return (
    <tbody>
      <tr className="ad-tr-group ad-ls-group">
        <th scope="colgroup" colSpan={3}>
          <div className="ad-ls-grouphead">
            <span>{title}</span>
            <span className="ad-ls-grouphint">{hint}</span>
            {copy && people.length > 0 && (
              <span className="ad-ls-groupend">
                <CopyEmailsButton emails={people.map((p) => p.email)} />
              </span>
            )}
          </div>
        </th>
      </tr>
      {people.length === 0 ? (
        <tr>
          <td colSpan={3}>
            <Status tone="ok">None</Status>
          </td>
        </tr>
      ) : (
        people.map((p) => (
          <tr key={p.email}>
            <td data-label="Name">
              <Link href={`/admin/students/${encodeURIComponent(p.email)}`} className="ad-ls-name">
                {p.displayName}
              </Link>
            </td>
            <td data-label="Email" className="ad-muted">
              {p.email}
            </td>
            <td data-label="Position">
              {/* Derived from positionId being unset (a ghosted roster title), not a stored flag. */}
              {p.positionName}
              {p.positionId === null && (
                <span className="ad-ls-marks">
                  <Pill tone="danger">No position</Pill>
                  {p.rosterTitle && <span className="ad-faint">{p.rosterTitle}</span>}
                </span>
              )}
            </td>
          </tr>
        ))
      )}
    </tbody>
  );
}
