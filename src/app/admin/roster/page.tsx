import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/AdminPage";
import { Disclosure, Notice, PageSettings, Panel, Stat, StatStrip } from "@/components/admin/ui";
import { getRosterStatus } from "@/lib/roster/status";
import { getRosterConfig } from "@/lib/settings";
import { RosterImportPanel } from "@/components/admin/RosterImportPanel";
import { ExcludedTitlesPanel } from "@/components/admin/ExcludedTitlesPanel";
import { RosterReadingPanel } from "@/components/admin/RosterReadingPanel";

export const metadata: Metadata = { title: "Roster import" };

export default async function AdminRosterPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/roster");
  if (!session.isAdmin) redirect("/me");

  const [status, config] = await Promise.all([getRosterStatus(), getRosterConfig()]);
  const defaultSheet = config.sheetCandidates[0];
  const excludedTitles = [...config.excludedTitles];

  return (
    <AdminPage title="Roster import" width="form">
      <div className="ad-stack">
        {status.ghostTitles.length > 0 && (
          <Notice tone="danger" title="Students without a position">
            <p>
              These roster titles have no matching position, so the students cannot fill out the
              availability form:
            </p>
            <ul className="ad-bullets">
              {status.ghostTitles.map((g) => (
                <li key={g.title ?? ""}>
                  {g.title ?? "No title recorded"}: {g.count} student{g.count === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
            <p>
              <Link href="/admin/positions">Resolve these titles on the positions page</Link>
            </p>
          </Notice>
        )}

        <Panel title="Upload workbook">
          <RosterImportPanel defaultSheet={defaultSheet} />
        </Panel>

        <PageSettings
          summary={`Sheets: ${config.sheetCandidates.join(", ")}. Excluded titles: ${
            excludedTitles.length > 0 ? excludedTitles.join(", ") : "none"
          }`}
        >
          <h2>Roster settings</h2>
          <p className="ad-muted">How this semester&apos;s tracker is read.</p>
          <RosterReadingPanel
            reading={{
              sheetCandidates: config.sheetCandidates.join("\n"),
              leavingSheet: config.leavingSheet,
              adminTitles: [...config.adminTitles].join("\n"),
              columns: config.columns,
            }}
          />

          <h2 className="ad-subhead--ruled">Excluded titles</h2>
          <p className="ad-muted">
            Rows with these position titles are skipped by the import. They are not added as
            students or admins.
          </p>
          <ExcludedTitlesPanel titles={excludedTitles} />
        </PageSettings>

        <Panel title="Current roster">
          <div className="ad-stack ad-stack--tight">
            <StatStrip>
              <Stat label="Active students" value={status.onRoster} />
              <Stat label="Off-roster" value={status.offRoster} />
              <Stat label="Imported admins" value={status.admins} />
            </StatStrip>
            <p className="ad-muted">
              {status.lastImport ? (
                <>
                  Last import: {status.lastImport.importedAt.toLocaleString()} by{" "}
                  {status.lastImport.importedBy} ({status.lastImport.rowCount} rows)
                </>
              ) : (
                <>No roster has been imported yet.</>
              )}
            </p>
          </div>
        </Panel>

        <Disclosure title="About this page">
          <p>
            Upload the current roster tracker (.xlsx, or a .csv export of one sheet) to bring the
            roster up to date. Everyone on the sheet is added or refreshed as a student. Anyone the
            sheet no longer lists is taken off the roster (they drop out of the response list,
            export, and non-response tracking, though their submission is kept). If that would take
            off more than a fifth of the roster, the import stops and asks you first. Shift leads
            who leave come off their weekend closes after the resignation date on the{" "}
            {config.leavingSheet} sheet; if there is no date, the import asks you. Leave{" "}
            <strong>Sheet</strong> blank to read the {defaultSheet} sheet. Re-importing the same
            file is safe.
          </p>
        </Disclosure>
      </div>
    </AdminPage>
  );
}
