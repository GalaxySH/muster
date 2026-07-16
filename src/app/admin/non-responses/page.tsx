import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listNonResponses, type RosterPerson } from "@/lib/admin/data";
import { CopyEmailsButton } from "@/components/admin/CopyEmailsButton";
import { Page } from "@/components/ui";

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
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Non-responses</h1>
      <p style={{ color: "var(--color-text-secondary)" }}>
        <strong>{report.respondedCount}</strong> of <strong>{report.rosterTotal}</strong> roster
        students submitted ({pct}%). <strong>{outstanding}</strong> outstanding.
      </p>
      {outstanding > 0 && (
        <p>
          <CopyEmailsButton
            emails={outstandingEmails}
            label={`Copy ${outstanding} outstanding email${outstanding === 1 ? "" : "s"}`}
          />
        </p>
      )}

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
          title={`Off-roster responders (${report.offRoster.length})`}
          hint="Submitted but not on the current roster. Position and international status may be self-reported."
          people={report.offRoster}
        />
      )}
    </Page>
  );
}

function Group({ title, hint, people }: { title: string; hint: string; people: RosterPerson[] }) {
  return (
    <section style={card}>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "2px 0 10px" }}>
        {hint}
      </div>
      {people.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-text-success)", margin: 0 }}>None ✓</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
          {people.map((p) => (
            <li key={p.email} style={{ fontSize: 14 }}>
              <Link href={`/admin/students/${encodeURIComponent(p.email)}`}>{p.displayName}</Link>{" "}
              <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
                {p.email}
                {p.positionName ? ` · ${p.positionName}` : ""}
              </span>
              {p.positionId === null && (
                <>
                  {" "}
                  <span style={noPositionPill}>No position</span>
                  {p.rosterTitle && (
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
                      {" "}
                      {p.rosterTitle}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Derived from positionId being unset (a ghosted roster title), not a stored flag. */
const noPositionPill: React.CSSProperties = {
  background: "#fce8e6",
  color: "var(--color-text-danger)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const card: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  marginTop: 14,
};
