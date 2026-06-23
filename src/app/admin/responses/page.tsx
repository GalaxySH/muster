import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listResponses } from "@/lib/admin/data";
import { getResponsesSheetUrl, getLastSheetSync } from "@/lib/admin/sheet-sync";
import { ResponseList } from "@/components/admin/ResponseList";
import { ResponsesToolbar } from "@/components/admin/ResponsesToolbar";

/**
 * The response dashboard (PLAN §10): the navigation hub into the per-student
 * view. Lists every submission; the per-student prev/next walks this same order.
 */
export default async function ResponsesPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/responses");
  if (!session.isAdmin) redirect("/me");

  const [rows, sheetUrl, lastSync] = await Promise.all([
    listResponses(),
    getResponsesSheetUrl(),
    getLastSheetSync(),
  ]);

  return (
    <main style={{ padding: "1.5rem", maxWidth: 980, margin: "0 auto", color: "var(--color-text-primary)" }}>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/non-responses" label="Non-responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Responses</h1>
      <ResponsesToolbar sheetUrl={sheetUrl} lastSyncedAtMs={lastSync ? lastSync.getTime() : null} />
      {rows.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>No submissions yet.</p>
      ) : (
        <ResponseList rows={rows} />
      )}
    </main>
  );
}
