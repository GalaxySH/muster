import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listNonResponses, type RosterPerson } from "@/lib/admin/data";
import { CopyEmailsButton } from "@/components/admin/CopyEmailsButton";

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
    <main style={page}>
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
        linkToDetail
      />
      {report.offRoster.length > 0 && (
        <Group
          title={`Off-roster responders (${report.offRoster.length})`}
          hint="Submitted but not on the current roster — position/intl may be self-reported."
          people={report.offRoster}
          linkToDetail
        />
      )}
    </main>
  );
}

function Group({
  title,
  hint,
  people,
  linkToDetail,
}: {
  title: string;
  hint: string;
  people: RosterPerson[];
  linkToDetail?: boolean;
}) {
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
              {linkToDetail ? (
                <Link href={`/admin/students/${encodeURIComponent(p.email)}`}>{p.displayName}</Link>
              ) : (
                p.displayName
              )}{" "}
              <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
                {p.email}
                {p.positionName ? ` · ${p.positionName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const page: React.CSSProperties = {
  padding: "1.5rem",
  maxWidth: 820,
  margin: "0 auto",
  color: "var(--color-text-primary)",
};
const card: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  marginTop: 14,
};
