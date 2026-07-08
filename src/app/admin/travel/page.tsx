import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { loadUpcomingTravel } from "@/lib/admin/data";
import { Page } from "@/components/ui";

/**
 * Upcoming-travel tab (roadmap 2.3): on-roster students traveling now through the
 * next three weeks, grouped by week so the scheduler can plan around them. Every
 * stored entry is excused (PLAN §8), so this is a plain who-is-away-when list.
 */
export default async function AdminTravelPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/travel");
  if (!session.isAdmin) redirect("/me");

  const weeks = await loadUpcomingTravel();

  return (
    <Page width="wide">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Upcoming travel</h1>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        Students traveling now through the next three weeks. Schedule around these dates.
      </p>

      {weeks.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>No travel in the next three weeks.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {weeks.map((w) => (
            <section key={w.weekStart} style={weekCard}>
              <h2 style={weekHeader}>Week of {fmtDay(w.weekStart)}</h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {w.entries.map((entry) => (
                  <li key={entry.id} style={row}>
                    <div>
                      <Link
                        href={`/admin/students/${encodeURIComponent(entry.studentEmail)}`}
                        style={{ fontWeight: 500 }}
                      >
                        {entry.studentName}
                      </Link>
                      {entry.positionName && (
                        <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>
                          {" "}
                          · {entry.positionName}
                        </span>
                      )}
                      {entry.note && (
                        <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
                          {entry.note}
                        </div>
                      )}
                    </div>
                    <span style={dateRange}>{fmtRange(entry.startDate, entry.endDate)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const fmtRange = (start: string, end: string) =>
  start === end ? fmtDay(start) : `${fmtDay(start)} to ${fmtDay(end)}`;

const weekCard: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
};
const weekHeader: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 15,
  fontWeight: 700,
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  borderTop: "0.5px solid var(--color-border-tertiary)",
  paddingTop: 8,
};
const dateRange: React.CSSProperties = {
  whiteSpace: "nowrap",
  fontSize: 13,
  color: "var(--color-text-primary)",
  fontWeight: 500,
};
