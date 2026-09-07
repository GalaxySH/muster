import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listResponses } from "@/lib/admin/data";
import { listGroups } from "@/lib/groups/data";
import { listPositions } from "@/lib/positions/data";
import { parseResponseFilters, serializeResponseFilters } from "@/lib/admin/response-filters";
import { parseResponseSort } from "@/lib/admin/response-sort";
import { ResponseList } from "@/components/admin/ResponseList";
import { ResponseFilterBar } from "@/components/admin/ResponseFilterBar";
import { Page } from "@/components/ui";

/**
 * The response dashboard (PLAN §10): the navigation hub into the per-student
 * view. Lists every submission, and the students who never started one once the
 * submission-state filter (`status`) asks for them; the per-student prev/next
 * walks this same order. The filters (roadmap 2.2) live in the URL so they
 * follow the admin into the per-student view.
 *
 * The CSV download and the Drive sheet controls live on /admin/drive, with the
 * rest of the Drive surfaces.
 */
export default async function ResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{
    group?: string;
    position?: string;
    flag?: string;
    roster?: string;
    status?: string;
    /** The old show-everyone switch, still read so saved links keep working. */
    all?: string;
    started?: string;
    startedDate?: string;
    review?: string;
    /** Sort order carried from the response list (see admin/response-sort.ts). */
    sort?: string;
    dir?: string;
  }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/responses");
  if (!session.isAdmin) redirect("/me");

  const sp = await searchParams;
  const filters = parseResponseFilters(sp);
  const sort = parseResponseSort(sp);
  const filterQuery = serializeResponseFilters(filters);

  const [rows, groups, positions] = await Promise.all([
    listResponses(filters),
    listGroups(),
    listPositions({ includeInactive: true }),
  ]);
  const filtered = filterQuery !== "";

  const filterBar = (
    // Keyed because it crosses the server/client boundary as a prop: React
    // cannot tell a deserialized element was static JSX and warns without one.
    <ResponseFilterBar
      key="response-filters"
      groups={groups.map((g) => ({ id: g.id, name: g.name }))}
      group={sp.group}
      positions={positions.map((p) => ({ id: p.position.id, name: p.position.name }))}
      position={sp.position}
      flag={sp.flag}
      roster={sp.roster}
      status={filters.status}
      started={sp.started}
      startedDate={sp.startedDate}
      review={sp.review}
    />
  );

  return (
    <Page width="full">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/non-responses" label="Non-responses" />
        <Crumb href="/admin/drive" label="Export & sheet" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Responses</h1>
      {/* The list renders even when nothing matches, so the filter that emptied
          it is still there to change. */}
      <ResponseList
        rows={rows}
        filterQuery={filterQuery}
        initialSort={sort}
        filters={filterBar}
        emptyMessage={filtered ? "No one matches this filter." : "No submissions yet."}
      />
    </Page>
  );
}
