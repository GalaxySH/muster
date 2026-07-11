import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listResponses } from "@/lib/admin/data";
import { listGroups } from "@/lib/groups/data";
import { parseResponseFilters, serializeResponseFilters } from "@/lib/admin/response-filters";
import { getSheetUrl, getLastSheetSync, RESPONSES_SHEET } from "@/lib/admin/sheet-sync";
import { rebuildResponsesSheet } from "@/lib/admin/actions";
import { ResponseList } from "@/components/admin/ResponseList";
import { ResponseFilterBar } from "@/components/admin/ResponseFilterBar";
import { SheetControls, btnLink } from "@/components/admin/SheetControls";
import { Page } from "@/components/ui";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload } from "@awesome.me/kit-925f6dce39/icons/classic/regular";

/**
 * The response dashboard (PLAN §10): the navigation hub into the per-student
 * view. Lists every submission; the per-student prev/next walks this same order.
 * The group/flag filters (roadmap 2.2) live in the URL so they follow the admin
 * into the per-student view.
 */
export default async function ResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; flag?: string; roster?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/responses");
  if (!session.isAdmin) redirect("/me");

  const sp = await searchParams;
  const filters = parseResponseFilters(sp);
  const filterQuery = serializeResponseFilters(filters);

  const [rows, groups, sheetUrl, lastSync] = await Promise.all([
    listResponses(filters),
    listGroups(),
    getSheetUrl(RESPONSES_SHEET),
    getLastSheetSync(RESPONSES_SHEET),
  ]);
  const filtered = filterQuery !== "";

  return (
    <Page width="wide">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/non-responses" label="Non-responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Responses</h1>
      <SheetControls
        sheetUrl={sheetUrl}
        lastSyncedAtMs={lastSync ? lastSync.getTime() : null}
        rebuild={rebuildResponsesSheet}
        leading={
          <a href="/admin/responses/export" style={btnLink} download>
            Download CSV <FontAwesomeIcon icon={faDownload} />
          </a>
        }
      />
      <ResponseFilterBar
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        group={sp.group}
        flag={sp.flag}
        roster={sp.roster}
      />
      {rows.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>
          {filtered ? "No responses match this filter." : "No submissions yet."}
        </p>
      ) : (
        <ResponseList rows={rows} filterQuery={filterQuery} />
      )}
    </Page>
  );
}
