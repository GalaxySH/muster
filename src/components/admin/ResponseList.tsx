"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResponseRow } from "@/lib/admin/data";
import { FLAG_LABELS } from "@/lib/admin/response-filters";
import {
  compareResponses,
  joinQuery,
  serializeResponseSort,
  type ResponseSort,
  type SortKey,
} from "@/lib/admin/response-sort";
import { DeleteResponseButton } from "./DeleteResponseButton";

/** Flag types that keep their own red pill even in the compact count view. */
const ALERT_FLAGS = ["position_change", "revalidation_failed", "orphaned_selection"] as const;

/**
 * The response dashboard table (PLAN §10): the students the filters selected,
 * searchable and sortable, each row opening the per-student view. Rows with no
 * submission ("missing") come through when the all-students switch is on, and
 * their submission-only cells read as "—". Client-side filter/sort is fine at
 * roster scale (~400 rows); the server hands the full list once.
 * Renders as a `.stack-table` (full-bleed like the groups table): rows stack
 * into labeled blocks under 720px, and the flags cell swaps between individual
 * pills and a compact count by width (`.flags-expanded` / `.flags-count`).
 */
export function ResponseList({
  rows,
  filterQuery = "",
  initialSort,
}: {
  rows: ResponseRow[];
  /** Active group/flag filter as a query string; carried onto row links so the
   *  per-student view keeps the same filter for its prev/next walk (roadmap 2.2). */
  filterQuery?: string;
  /** The order from the URL, so a link back into the list restores it. */
  initialSort: ResponseSort;
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
            (r.positionName ?? "").toLowerCase().includes(q),
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

  const arrow = (key: SortKey) => (key === sort ? (dir === 1 ? " ▲" : " ▼") : "");

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
          margin: "0 0 12px",
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flex: "1 1 320px",
            maxWidth: 480,
            fontSize: 13,
            color: "var(--color-text-secondary)",
          }}
        >
          Search
          <input
            type="search"
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              minWidth: 240,
              padding: "8px 10px",
              borderRadius: "var(--border-radius-md)",
              border: "0.5px solid var(--color-border-secondary)",
              background: "var(--color-background-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
            }}
          />
        </label>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {filtered.length} of {rows.length} · {scheduledCount} scheduled · {flaggedCount} flagged
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="stack-table zebra-table" style={{ fontSize: 14 }}>
          <thead>
            <tr>
              <Th onClick={() => toggleSort("name")}>Name{arrow("name")}</Th>
              <Th onClick={() => toggleSort("position")}>Position{arrow("position")}</Th>
              <Th onClick={() => toggleSort("status")}>Status{arrow("status")}</Th>
              <Th onClick={() => toggleSort("requested")} className="cell-right">
                Requested{arrow("requested")}
              </Th>
              <Th onClick={() => toggleSort("flags")} className="cell-center">
                Flags{arrow("flags")}
              </Th>
              <Th onClick={() => toggleSort("scheduled")} className="cell-center">
                Scheduled{arrow("scheduled")}
              </Th>
              <Th onClick={() => toggleSort("updated")} className="cell-right">
                Updated{arrow("updated")}
              </Th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.email}
                onClick={() =>
                  router.push(`/admin/students/${encodeURIComponent(r.email)}${suffix}`)
                }
                style={{ cursor: "pointer" }}
              >
                <td data-label="Name">
                  <div style={{ fontWeight: 500 }}>
                    {r.displayName}
                    {r.openChangeRequests > 0 && (
                      <span
                        style={changeRequestPill}
                        title={
                          r.openChangeRequests === 1
                            ? "1 open change request"
                            : `${r.openChangeRequests} open change requests`
                        }
                      >
                        {r.openChangeRequests}
                      </span>
                    )}
                    {!r.onRoster && <span style={offRosterBadge}>off roster</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{r.email}</div>
                </td>
                <td data-label="Position">{r.positionName ?? "—"}</td>
                <td data-label="Status">
                  <span style={STATUS_BADGE[r.status]}>{r.status}</span>
                </td>
                <td data-label="Requested" className="cell-right">
                  {r.desiredHours ? `${r.desiredHours}h` : "—"}
                </td>
                <td data-label="Flags" className="cell-center">
                  {r.flagCount === 0 ? (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  ) : (
                    <>
                      <span className="flags-expanded">
                        {r.flagTypes.map((t, i) => (
                          <span key={`${t}-${i}`} style={alertBadge}>
                            {FLAG_LABELS[t]}
                          </span>
                        ))}
                      </span>
                      <span className="flags-count">
                        <span style={flagBadge}>⚠ {r.flagCount}</span>
                        {ALERT_FLAGS.filter((t) => r.flagTypes.includes(t)).map((t) => (
                          <div key={t} style={{ marginTop: 3 }}>
                            <span style={alertBadge}>{FLAG_LABELS[t]}</span>
                          </div>
                        ))}
                      </span>
                    </>
                  )}
                </td>
                <td data-label="Scheduled" className="cell-center">
                  {r.scheduled ? (
                    <span style={{ color: "var(--color-text-success)" }}>✓</span>
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </td>
                <td
                  data-label="Updated"
                  className="cell-right"
                  style={{
                    color: "var(--color-text-tertiary)",
                    fontSize: 13,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtDate(r.submittedAt ?? r.updatedAt)}
                </td>
                <td className="cell-right">
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
                <td
                  colSpan={8}
                  style={{ color: "var(--color-text-tertiary)", textAlign: "center" }}
                >
                  Nothing matches your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const fmtDate = (d: Date | null) =>
  d
    ? new Date(d).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

function Th({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={className}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {children}
    </th>
  );
}

const badge: React.CSSProperties = { borderRadius: 10, padding: "1px 8px", fontSize: 12 };
const submittedBadge: React.CSSProperties = {
  ...badge,
  background: "#e6f4ea",
  color: "var(--color-text-success)",
};
const draftBadge: React.CSSProperties = {
  ...badge,
  background: "var(--color-background-secondary)",
  color: "var(--color-text-secondary)",
};
const flagBadge: React.CSSProperties = {
  ...badge,
  background: "var(--color-background-warning)",
  color: "var(--color-text-warning)",
};
const alertBadge: React.CSSProperties = {
  ...badge,
  background: "#fce8e6",
  color: "var(--color-text-danger)",
  whiteSpace: "nowrap",
};
const STATUS_BADGE: Record<ResponseRow["status"], React.CSSProperties> = {
  submitted: submittedBadge,
  draft: draftBadge,
  missing: alertBadge,
};
const offRosterBadge: React.CSSProperties = {
  ...badge,
  background: "var(--color-background-secondary)",
  color: "var(--color-text-secondary)",
  fontWeight: 400,
  marginLeft: 6,
};
const changeRequestPill: React.CSSProperties = {
  ...badge,
  background: "#e8f0fe",
  color: "var(--color-text-link, #1a66cc)",
  fontWeight: 600,
  marginLeft: 6,
  padding: "1px 7px",
};
