import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { loadCloseAdmin } from "@/lib/closes/data";
import { getSheetUrl, getLastSheetSync, CLOSES_SHEET } from "@/lib/admin/sheet-sync";
import { rebuildClosesSheet } from "@/lib/closes/admin-actions";
import { workingTerm, workingTermId } from "@/lib/terms/working";
import { CloseInventoryPanel } from "@/components/admin/CloseInventoryPanel";
import { CloseLeadProgress } from "@/components/admin/CloseLeadProgress";
import { CloseWeekendBoard } from "@/components/admin/CloseWeekendBoard";
import { SheetControls } from "@/components/admin/SheetControls";
import { InfoCard, Page } from "@/components/ui";

/**
 * Admin page for SL weekend closes (PLAN §18a): each lead's required number and
 * progress, then the closes by weekend with direct assign and remove controls.
 * The inventory editor and the backup sheet are used rarely, so they sit behind
 * a disclosure once an inventory exists.
 */
export default async function AdminClosesPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/closes");
  if (!session.isAdmin) redirect("/me");

  const termId = await workingTermId();
  const [term, view, sheetUrl, lastSync] = await Promise.all([
    workingTerm(),
    loadCloseAdmin(termId),
    getSheetUrl(CLOSES_SHEET, termId),
    getLastSheetSync(CLOSES_SHEET, termId),
  ]);

  const hasSlots = view.slots.length > 0;
  const first = view.slots[0];
  const last = view.slots[view.slots.length - 1];
  const defaults =
    first && last
      ? { start: first.date, end: last.date, capacity: first.capacity }
      : { start: term.startsOn, end: term.endsOn, capacity: 3 };

  const filled = view.slots.reduce((n, s) => n + s.claimants.length, 0);
  const closesWord = view.slots.length === 1 ? "close" : "closes";

  return (
    <Page width="full">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>SL weekend closes</h1>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        Shift Leads pick weekend closes as part of the availability form. A new lead starts
        at {view.defaultRequirement}. <Link href="/admin/terms">Change on the Semester page</Link>
      </p>

      {hasSlots && view.leads.length > 0 && !view.feasibility.feasible && (
        <InfoCard tone="danger" title="Not enough spots">
          <p style={{ margin: 0 }}>
            {view.leads.length} active Shift Leads need {view.feasibility.required} spots in
            total, but the inventory only has {view.feasibility.available}. Extend the range,
            raise the spots per shift, or lower a lead&apos;s number.
          </p>
        </InfoCard>
      )}

      {!hasSlots && (
        <section style={card}>
          <h2 style={h2}>Inventory</h2>
          <p style={{ marginTop: 0, color: "var(--color-text-secondary)" }}>
            No close shifts exist yet. Students see the picking step only after you generate
            them.
          </p>
          <CloseInventoryPanel defaults={defaults} hasSlots={false} />
        </section>
      )}

      {hasSlots &&
        (view.leads.length === 0 ? (
          <section style={card}>
            <h2 style={h2}>Shift Lead progress</h2>
            <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
              No active Shift Leads on the roster.
            </p>
          </section>
        ) : (
          <CloseLeadProgress leads={view.leads} defaultRequirement={view.defaultRequirement} />
        ))}

      {hasSlots && (
        <>
          <div style={closesHead}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Closes</h2>
            <span style={{ color: "var(--color-text-secondary)" }}>
              {view.slots.length} {closesWord}, {view.feasibility.available} spots, {filled}{" "}
              filled. Leads need {view.feasibility.required} in total.
            </span>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
            Changes made here are visible to employees right away.
          </p>
          <details style={{ marginBottom: 6 }}>
            <summary style={{ cursor: "pointer", color: "var(--color-text-info)" }}>
              Inventory and Google Sheet
            </summary>
            <div style={{ ...card, marginTop: 10 }}>
              <SheetControls
                sheetUrl={sheetUrl}
                lastSyncedAtMs={lastSync ? lastSync.getTime() : null}
                rebuild={rebuildClosesSheet}
              />
              <CloseInventoryPanel defaults={defaults} hasSlots />
            </div>
          </details>
          <CloseWeekendBoard slots={view.slots} leads={view.leads} />
        </>
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
const closesHead: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "4px 12px",
  margin: "22px 0 4px",
};
