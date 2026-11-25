import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { loadUpcomingTravel } from "@/lib/admin/data";
import { UpcomingTravelRow } from "@/components/admin/UpcomingTravelRow";
import { formatDayLabel } from "@/components/admin/ui";
import { Page } from "@/components/ui";

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

  return (
    <Page width="wide">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Upcoming travel</h1>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        Travel for the next three weeks. Mark each one resolved once you have worked it into the
        schedule.
      </p>

      {weeks.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>No travel in the next three weeks.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {weeks.map((w) => (
            <section key={w.weekStart} style={weekCard}>
              <h2 style={weekHeader}>Week of {formatDayLabel(w.weekStart)}</h2>
              {/* A zero minimum on the column, so a long name cannot widen every row. */}
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: 8,
                }}
              >
                {w.entries.map((entry) => (
                  <UpcomingTravelRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

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
