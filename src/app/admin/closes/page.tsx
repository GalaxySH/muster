import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadCloseAdmin } from "@/lib/closes/data";
import { getSheetUrl, getLastSheetSync, CLOSES_SHEET } from "@/lib/admin/sheet-sync";
import { rebuildClosesSheet } from "@/lib/closes/admin-actions";
import { workingTerm, workingTermId } from "@/lib/terms/working";
import { formatCloseDate } from "@/lib/domain/close-claims";
import { CloseInventoryPanel } from "@/components/admin/CloseInventoryPanel";
import { CloseLeadProgress } from "@/components/admin/CloseLeadProgress";
import { CloseWeekendBoard } from "@/components/admin/CloseWeekendBoard";
import { SheetControls } from "@/components/admin/SheetControls";
import { AdminPage } from "@/components/admin/AdminPage";
import { Notice, PageSettings, Panel, SettingRow } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Weekend closes" };

/**
 * Admin page for SL weekend closes (PLAN §18a): each lead's required number and
 * progress, then the closes by weekend with direct assign and remove controls.
 * The inventory editor, the backup sheet and the link to the default number are
 * used rarely, so they sit in the page's Settings section, which starts open
 * only while there is no inventory yet.
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
    <AdminPage
      title="Weekend closes"
      description="Shift Leads pick weekend closes as part of the availability form."
    >
      <div className="ad-stack">
        {hasSlots && view.leads.length > 0 && !view.feasibility.feasible && (
          <Notice tone="danger" title="Not enough spots">
            <p>
              {view.leads.length} active Shift Leads need {view.feasibility.required} spots in
              total, but the inventory only has {view.feasibility.available}. Extend the range,
              raise the spots per shift, or lower a lead&apos;s number.
            </p>
          </Notice>
        )}

        <PageSettings
          open={!hasSlots}
          summary={
            first && last
              ? `${formatCloseDate(first.date)} to ${formatCloseDate(last.date)}, ${first.capacity} spots per shift`
              : "No inventory yet"
          }
        >
          <SettingRow
            name="Default closes per Shift Lead"
            help={<>A new lead starts at {view.defaultRequirement}.</>}
          >
            <Link href="/admin/terms">Change on the Semester page</Link>
          </SettingRow>

          <h2 className="ad-subhead--ruled">Inventory</h2>
          {!hasSlots && (
            <p className="ad-muted">
              No close shifts exist yet. Students see the picking step only after you generate them.
            </p>
          )}
          <CloseInventoryPanel
            // A fresh editor once an inventory exists, reading the generated range.
            key={hasSlots ? "update" : "generate"}
            defaults={defaults}
            hasSlots={hasSlots}
          />

          {hasSlots && (
            <>
              <h2 className="ad-subhead--ruled">Google Sheet</h2>
              <SheetControls
                sheetUrl={sheetUrl}
                lastSyncedAtMs={lastSync ? lastSync.getTime() : null}
                rebuild={rebuildClosesSheet}
              />
            </>
          )}
        </PageSettings>

        {hasSlots &&
          (view.leads.length === 0 ? (
            <Panel title="Shift Lead progress">
              <p className="ad-muted">No active Shift Leads on the roster.</p>
            </Panel>
          ) : (
            <CloseLeadProgress leads={view.leads} defaultRequirement={view.defaultRequirement} />
          ))}

        {hasSlots && (
          <section>
            <div className="ad-subhead">
              <h2>Closes</h2>
              <span className="ad-muted">
                {view.slots.length} {closesWord}, {view.feasibility.available} spots, {filled}{" "}
                filled. Leads need {view.feasibility.required} in total.
              </span>
            </div>
            <p className="ad-help">Changes made here are visible to employees right away.</p>
            <CloseWeekendBoard slots={view.slots} leads={view.leads} />
          </section>
        )}
      </div>
    </AdminPage>
  );
}
