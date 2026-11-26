"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
// Tree-shakeable per-icon import; `byPrefixAndName` would pull the whole library.
import { faCalendarDays } from "@awesome.me/kit-925f6dce39/icons/classic/regular";
import type { ResponseRow } from "@/lib/admin/data";
import { FLAG_LABELS } from "@/lib/admin/response-filters";
import {
  compareResponses,
  joinQuery,
  serializeResponseSort,
  type ResponseSort,
  type SortKey,
} from "@/lib/admin/response-sort";
import { hoursLabel } from "@/lib/domain/config-validation";
import { DeleteResponseButton } from "./DeleteResponseButton";
import { StudentScheduleModalLink } from "./StudentSchedulePopup";
import { EmptyMark, EmptyState, Panel, Pill, VisuallyHidden } from "./ui";

/** Flag types that keep their own red pill even in the compact count view. */
const ALERT_FLAGS = ["position_change", "revalidation_failed", "orphaned_selection"] as const;

const STATUS_TONE = { submitted: "success", draft: undefined, missing: "danger" } as const;

/**
 * The response dashboard table (PLAN §10): the students the filters selected,
 * searchable and sortable, each row opening the per-student view. Rows with no
 * submission ("missing") come through when the all-students switch is on, and
 * their submission-only cells read as "—". Client-side filter/sort is fine at
 * roster scale (~400 rows); the server hands the full list once.
 *
 * The page's URL filters ride in as `filters` rather than being rendered
 * alongside: filtering and searching are one job, so they share the one toolbar
 * above the table.
 *
 * Rows stack into labeled blocks under 720px. The flags cell names every flag
 * as its own pill, except between 720px and 1100px where there is no room: there
 * it is a count, with the names in its title and for a screen reader
 * (`.ad-ls-flags-full` / `.ad-ls-flags-count`).
 */
export function ResponseList({
  rows,
  filterQuery = "",
  initialSort,
  filters,
  emptyMessage = "No submissions yet.",
}: {
  rows: ResponseRow[];
  /** Active group/flag filter as a query string; carried onto row links so the
   *  per-student view keeps the same filter for its prev/next walk (roadmap 2.2). */
  filterQuery?: string;
  /** The order from the URL, so a link back into the list restores it. */
  initialSort: ResponseSort;
  /** The URL-backed filter controls, rendered into this table's toolbar. */
  filters?: React.ReactNode;
  /** Shown in place of the table when the server handed over no rows at all. */
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(initialSort.key);
  const [dir, setDir] = useState<1 | -1>(initialSort.dir);
  // Row links carry the order as well as the filters, so the per-student view
  // walks and jumps through the list as it is on screen, not in name order.
  const linkQuery = joinQuery(filterQuery, serializeResponseSort({ key: sort, dir }));
  const suffix = linkQuery ? `?${linkQuery}` : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter(
          (r) =>
            r.displayName.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            (r.positionName ?? "").toLowerCase().includes(q) ||
            (r.groupName ?? "").toLowerCase().includes(q),
        )
      : rows;
    const sorted = [...base].sort((a, b) => dir * compareResponses(a, b, sort));
    return sorted;
  }, [rows, query, sort, dir]);

  const scheduledCount = rows.filter((r) => r.scheduled).length;
  const flaggedCount = rows.filter((r) => r.flagCount > 0).length;

  function toggleSort(key: SortKey) {
    if (key === sort) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(key);
      setDir(1);
    }
  }

  const sortTh = (key: SortKey, label: string, className?: string, title?: string) => (
    <th
      scope="col"
      className={className}
      aria-sort={key === sort ? (dir === 1 ? "ascending" : "descending") : undefined}
    >
      <button type="button" className="ad-sortbtn" title={title} onClick={() => toggleSort(key)}>
        {label}
        {/* The th says the order (aria-sort); the glyph is for the eye. */}
        {key === sort && <span aria-hidden>{dir === 1 ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );

  return (
    <Panel flush as="div">
      <div className="ad-toolbar">
        {filters}
        <label className="ad-ls-search">
          Search
          <input
            type="search"
            placeholder="Search name, email, position or group"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="ad-toolbar-end">
          {/* Announced, politely, when a search or sort changes the count. */}
          <span role="status" className="ad-ls-count">
            {filtered.length} of {rows.length} · {scheduledCount} scheduled · {flaggedCount} flagged
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : (
        <table className="ad-table ad-table--stack ad-table--zebra ad-table--hover ad-table--middle">
          <thead>
            <tr>
              {sortTh("name", "Name")}
              {sortTh("position", "Position")}
              {sortTh("group", "Group")}
              {sortTh("status", "Status")}
              {sortTh(
                "requested",
                "Hours",
                "ad-num",
                "Scheduled hours of the hours they asked for. Sorts by the hours they asked for.",
              )}
              {sortTh("flags", "Flags", "ad-center")}
              {sortTh("scheduled", "Scheduled", "ad-center")}
              {sortTh("updated", "Updated", "ad-num")}
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.email}
                className="ad-ls-rowlink"
                onClick={() =>
                  router.push(`/admin/students/${encodeURIComponent(r.email)}${suffix}`)
                }
              >
                <td data-label="Name">
                  <div className="ad-ls-who">
                    <span className="ad-ls-name ad-ls-name--clip" title={r.displayName}>
                      {r.displayName}
                    </span>
                    <StudentScheduleModalLink
                      email={r.email}
                      displayName={r.displayName}
                      label={`Scheduled shifts for ${r.displayName}`}
                    >
                      <span className="ad-btn ad-btn--icon ad-ls-iconbtn">
                        <FontAwesomeIcon icon={faCalendarDays} aria-hidden />
                      </span>
                    </StudentScheduleModalLink>
                    {r.openChangeRequests > 0 && (
                      <Pill
                        tone="info"
                        title={
                          r.openChangeRequests === 1
                            ? "1 open change request"
                            : `${r.openChangeRequests} open change requests`
                        }
                      >
                        {r.openChangeRequests}
                      </Pill>
                    )}
                    {!r.onRoster && <Pill>off roster</Pill>}
                  </div>
                  <div className="ad-email">{r.email}</div>
                </td>
                <td data-label="Position">{r.positionName ?? <EmptyMark />}</td>
                <td data-label="Group">
                  {r.groupName ?? <span className="ad-danger-text">no group</span>}
                </td>
                <td data-label="Status">
                  <span className="ad-ls-marks">
                    <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                    {r.status === "submitted" && r.viaGoogleForm && <Pill>via Google Form</Pill>}
                  </span>
                </td>
                <td data-label="Hours" className="ad-num ad-nowrap">
                  <HoursCell scheduledMinutes={r.scheduledMinutes} desiredHours={r.desiredHours} />
                </td>
                <td data-label="Flags" className="ad-center">
                  {r.flagCount === 0 ? (
                    <EmptyMark />
                  ) : (
                    <>
                      <span className="ad-ls-flags-full">
                        {r.flagTypes.map((t, i) => (
                          <Pill key={`${t}-${i}`} tone="danger">
                            {FLAG_LABELS[t]}
                          </Pill>
                        ))}
                      </span>
                      <span
                        className="ad-ls-flags-count"
                        title={r.flagTypes.map((t) => FLAG_LABELS[t]).join(", ")}
                      >
                        <Pill tone="warning">
                          <span aria-hidden>⚠</span> {r.flagCount}
                          <VisuallyHidden>
                            {" "}
                            flags: {r.flagTypes.map((t) => FLAG_LABELS[t]).join(", ")}
                          </VisuallyHidden>
                        </Pill>
                        {ALERT_FLAGS.filter((t) => r.flagTypes.includes(t)).map((t) => (
                          <Pill key={t} tone="danger">
                            {FLAG_LABELS[t]}
                          </Pill>
                        ))}
                      </span>
                    </>
                  )}
                </td>
                <td data-label="Scheduled" className="ad-center">
                  {r.scheduled ? <Pill tone="success">Scheduled</Pill> : <EmptyMark />}
                </td>
                <td data-label="Updated" className="ad-num ad-nowrap ad-faint">
                  {fmtDate(r.submittedAt ?? r.updatedAt)}
                </td>
                <td className="ad-num">
                  {/* Nothing to delete for a student who never started. */}
                  {r.status !== "missing" && (
                    <DeleteResponseButton
                      studentEmail={r.email}
                      displayName={r.displayName}
                      variant="icon"
                    />
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="ad-center ad-faint">
                  Nothing matches your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/**
 * Scheduled against requested. The scheduled half only appears once the current
 * run holds shifts for them, which is independent of the "mark scheduled"
 * toggle: the run is what says how many hours they have.
 */
function HoursCell({
  scheduledMinutes,
  desiredHours,
}: {
  scheduledMinutes: number | null;
  desiredHours: number | null;
}) {
  const requested = desiredHours === null ? <EmptyMark /> : `${desiredHours}h`;
  if (scheduledMinutes === null) return <span>{requested}</span>;
  const title =
    desiredHours === null
      ? `${hoursLabel(scheduledMinutes)}h scheduled, no hours requested`
      : `${hoursLabel(scheduledMinutes)}h scheduled of ${desiredHours}h requested`;
  return (
    <span title={title}>
      <strong className="ad-ls-hours-got">{hoursLabel(scheduledMinutes)}</strong>
      <span className="ad-faint">/</span>
      {requested}
    </span>
  );
}

const fmtDate = (d: Date | null) =>
  d ? (
    new Date(d).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    })
  ) : (
    <EmptyMark />
  );
