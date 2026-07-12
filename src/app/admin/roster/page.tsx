import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { InfoCard, Page } from "@/components/ui";
import { getRosterStatus } from "@/lib/roster/status";
import { RosterImportPanel } from "@/components/admin/RosterImportPanel";

export default async function AdminRosterPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/roster");
  if (!session.isAdmin) redirect("/me");

  const status = await getRosterStatus();

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Roster import</h1>
      <p style={{ color: "#555" }}>
        Upload the current PCPL workbook (.xlsx) to bring the roster up to date. Rows on{" "}
        <strong>People Coming</strong> are added or refreshed as active students;
        rows on <strong>People Leaving</strong> are marked off-roster (they drop out of the
        response list, export, and non-response tracking, though their submission is kept).
        Re-importing the same workbook is safe.
      </p>

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Current roster</h2>
        <p style={{ margin: "0 0 6px", fontSize: 14 }}>
          <strong>{status.onRoster}</strong> active students · {status.offRoster} off-roster ·{" "}
          {status.admins} imported admins
        </p>
        <p style={{ margin: 0, fontSize: 14, color: "#777" }}>
          {status.lastImport ? (
            <>
              Last import: {status.lastImport.importedAt.toLocaleString()} by{" "}
              {status.lastImport.importedBy} ({status.lastImport.rowCount} rows)
            </>
          ) : (
            <>No roster has been imported yet.</>
          )}
        </p>
      </section>

      {status.ghostTitles.length > 0 && (
        <InfoCard tone="danger" title="Students without a position" style={{ marginTop: "1.2rem" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            These roster titles have no matching position, so the students cannot fill out the
            availability form:
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 14 }}>
            {status.ghostTitles.map((g) => (
              <li key={g.title ?? ""}>
                {g.title ?? "No title recorded"}: {g.count} student{g.count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: 14 }}>
            <Link href="/admin/positions">Resolve these titles on the positions page</Link>
          </p>
        </InfoCard>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Upload workbook</h2>
        <RosterImportPanel />
      </section>
    </Page>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
  marginTop: "1.2rem",
};
