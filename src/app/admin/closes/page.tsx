import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { loadCloseAdmin } from "@/lib/closes/data";
import { getSheetUrl, getLastSheetSync, CLOSES_SHEET } from "@/lib/admin/sheet-sync";
import { rebuildClosesSheet } from "@/lib/closes/admin-actions";
import {
  REQUIRED_CLOSE_CLAIMS,
  defaultCloseSemesterRange,
  formatCloseDate,
  remainingCapacity,
} from "@/lib/domain/close-claims";
import { formatTime } from "@/lib/domain/time";
import { CloseInventoryPanel } from "@/components/admin/CloseInventoryPanel";
import { SheetControls } from "@/components/admin/SheetControls";
import { InfoCard, Page } from "@/components/ui";

/**
 * Admin dashboard for SL weekend closes (PLAN §18a): everyone's claims per
 * slot, per-lead progress toward the required picks, a capacity feasibility
 * check, and the inventory editor. Claims are also backed up to a second
 * Drive sheet (the SheetControls row).
 */
export default async function AdminClosesPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/closes");
  if (!session.isAdmin) redirect("/me");

  const [view, sheetUrl, lastSync] = await Promise.all([
    loadCloseAdmin(),
    getSheetUrl(CLOSES_SHEET),
    getLastSheetSync(CLOSES_SHEET),
  ]);

  const hasSlots = view.slots.length > 0;
  const first = view.slots[0];
  const last = view.slots[view.slots.length - 1];
  const defaults =
    first && last
      ? { start: first.date, end: last.date, capacity: first.capacity }
      : { ...defaultCloseSemesterRange(new Date()), capacity: 3 };

  const unfinished = view.leads.filter((l) => !l.complete);

  return (
    <Page width="wide">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>SL weekend closes</h1>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        Every Shift Lead claims {REQUIRED_CLOSE_CLAIMS} weekend close shifts for the semester.
      </p>

      {hasSlots && (
        <SheetControls
          sheetUrl={sheetUrl}
          lastSyncedAtMs={lastSync ? lastSync.getTime() : null}
          rebuild={rebuildClosesSheet}
        />
      )}

      {hasSlots && view.leads.length > 0 && !view.feasibility.feasible && (
        <InfoCard tone="danger" title="Not enough spots">
          <p style={{ margin: 0 }}>
            {view.leads.length} active Shift Leads need {view.feasibility.required} spots in
            total, but the inventory only has {view.feasibility.available}. Extend the range or
            raise the spots per shift.
          </p>
        </InfoCard>
      )}

      <section style={card}>
        <h2 style={h2}>Inventory</h2>
        {!hasSlots && (
          <p style={{ marginTop: 0, color: "var(--color-text-secondary)" }}>
            No close shifts exist yet. Students see the picking step only after you generate
            them.
          </p>
        )}
        <CloseInventoryPanel defaults={defaults} hasSlots={hasSlots} />
      </section>

      {hasSlots && (
        <section style={card}>
          <h2 style={h2}>Shift Lead progress</h2>
          {view.leads.length === 0 ? (
            <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
              No active Shift Leads on the roster.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 0, color: "var(--color-text-secondary)" }}>
                {unfinished.length === 0
                  ? `All ${view.leads.length} Shift Leads have their picks.`
                  : `${unfinished.length} of ${view.leads.length} Shift Leads still need picks.`}
              </p>
              <ul style={leadList}>
                {view.leads.map((l) => (
                  <li key={l.email} style={leadRow}>
                    <Link href={`/admin/students/${encodeURIComponent(l.email)}`}>
                      {l.displayName}
                    </Link>
                    <span style={{ color: l.complete ? "var(--color-text-success)" : "var(--color-text-danger)", fontWeight: 600 }}>
                      {l.complete ? "✓ " : ""}
                      {l.claimCount} of {REQUIRED_CLOSE_CLAIMS}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {hasSlots && (
        <section style={card}>
          <h2 style={h2}>Claims by shift</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Shift</th>
                  <th style={th}>Time</th>
                  <th style={th}>Claimed</th>
                  <th style={th}>Open</th>
                  <th style={th}>Claimed by</th>
                </tr>
              </thead>
              <tbody>
                {view.slots.map((s) => (
                  <tr key={s.id}>
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>
                      {formatCloseDate(s.date)}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {formatTime(s.startMinutes)}–{formatTime(s.endMinutes)}
                    </td>
                    <td style={td}>
                      {s.claimants.length} of {s.capacity}
                    </td>
                    <td style={td}>{remainingCapacity(s.capacity, s.claimants.length)}</td>
                    <td style={td}>
                      {s.claimants.map((c, i) => (
                        <span key={c.email}>
                          {i > 0 && ", "}
                          <Link href={`/admin/students/${encodeURIComponent(c.email)}`}>
                            {c.displayName}
                          </Link>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Page>
  );
}

const card: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  marginBottom: 16,
};
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 15, fontWeight: 700 };
const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 13,
  padding: "6px 10px",
  borderBottom: "1px solid var(--color-border-secondary)",
};
const td: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  fontSize: 14,
  verticalAlign: "top",
};
const leadList: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: 6,
  maxWidth: 420,
};
const leadRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  borderTop: "0.5px solid var(--color-border-tertiary)",
  paddingTop: 6,
};
