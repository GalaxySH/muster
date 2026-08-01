import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { Page } from "@/components/ui";
import { StatTile, SectionLabel, panelStyle, cardsGridStyle } from "@/components/admin/ui";
import { CopyEmailsButton } from "@/components/admin/CopyEmailsButton";
import { loadAnalyticsStudents } from "@/lib/admin/analytics";
import { buildAnalyticsView } from "@/lib/admin/analytics-view";

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
    <Page width="full" style={{ padding: "1.25rem 1.5rem" }}>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>

      <div style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Sign-in analytics</h1>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          Who has logged in, out of {view.total} on the roster · as of {clock(now)}
        </div>
      </div>

      <div style={cardsGridStyle}>
        <StatTile
          label="Signed in"
          value={
            <>
              {view.everSignedIn} <span style={ofTotal}>of {view.total}</span>
            </>
          }
          sub={`${view.signedInPercent}% of the roster`}
        />
        <StatTile
          label="Never signed in"
          value={view.neverSignedIn}
          sub="have not logged in yet"
          subTone={view.neverSignedIn > 0 ? "warning" : undefined}
        />
        <StatTile label="Submitted" value={funnel.submitted} sub="finished the form" />
        <StatTile label="Active today" value={recency.today} sub="signed in within 24 hours" />
      </div>

      <div style={{ ...twoCol, marginTop: 14 }}>
        {/* Where the roster sits on the way to a finished response. */}
        <section style={{ ...panelStyle, marginBottom: 0 }}>
          <SectionLabel>Progress to submitted</SectionLabel>
          <FunnelBar
            label="Never signed in"
            count={funnel.neverSignedIn}
            total={view.total}
            color="var(--color-border-tertiary)"
          />
          <FunnelBar
            label="Signed in, no submission"
            count={funnel.signedInNotSubmitted}
            total={view.total}
            color="var(--color-background-warning)"
          />
          <FunnelBar
            label="Submitted"
            count={funnel.submitted}
            total={view.total}
            color="var(--color-text-info)"
          />
        </section>

        {/* How fresh the sign-ins are: a live roster vs. one that logged in once. */}
        <section style={{ ...panelStyle, marginBottom: 0 }}>
          <SectionLabel action={<span style={hint}>of the {view.everSignedIn} signed in</span>}>
            Last active
          </SectionLabel>
          <RecencyRow label="Today" count={recency.today} total={view.everSignedIn} />
          <RecencyRow label="This week" count={recency.week} total={view.everSignedIn} />
          <RecencyRow label="This month" count={recency.month} total={view.everSignedIn} />
          <RecencyRow label="Over a month ago" count={recency.dormant} total={view.everSignedIn} />
        </section>
      </div>

      <section style={{ ...panelStyle, marginTop: 14 }}>
        <SectionLabel
          action={
            view.neverSignedInPeople.length > 0 ? (
              <CopyEmailsButton
                emails={view.neverSignedInPeople.map((p) => p.email)}
                label={`Copy all ${view.neverSignedInPeople.length}`}
              />
            ) : null
          }
        >
          Never signed in
        </SectionLabel>
        {view.neverSignedInPeople.length === 0 ? (
          <p style={{ ...footnote, marginTop: 0 }}>Everyone on the roster has signed in.</p>
        ) : (
          <div style={nameGrid}>
            {view.neverSignedInPeople.map((p) => (
              <a
                key={p.email}
                href={`/admin/students/${encodeURIComponent(p.email)}`}
                style={nameCell}
              >
                {p.displayName}
              </a>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

function FunnelBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div style={{ padding: "6px 0", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}
      >
        <span>{label}</span>
        <span style={{ color: "var(--color-text-secondary)" }}>
          {count} · {pct}%
        </span>
      </div>
      <div style={barTrack}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color }} />
      </div>
    </div>
  );
}

function RecencyRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div style={listRow}>
      <span>{label}</span>
      <span style={{ marginLeft: "auto", color: "var(--color-text-secondary)" }}>
        {count} · {pct}%
      </span>
    </div>
  );
}

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// --- styles ---

const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
  gap: 14,
};

const ofTotal: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  color: "var(--color-text-tertiary)",
};

const hint: React.CSSProperties = {
  fontWeight: 400,
  fontSize: 12,
  color: "var(--color-text-tertiary)",
};

const barTrack: React.CSSProperties = {
  height: 6,
  borderRadius: 3,
  overflow: "hidden",
  background: "var(--color-background-secondary)",
};

const listRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "6px 0",
  fontSize: 13,
  borderTop: "0.5px solid var(--color-border-tertiary)",
};

const nameGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "2px 12px",
};

const nameCell: React.CSSProperties = {
  fontSize: 13,
  padding: "3px 0",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const footnote: React.CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-tertiary)",
  margin: 0,
};
