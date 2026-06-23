"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResponseRow } from "@/lib/admin/data";
import { DeleteResponseButton } from "./DeleteResponseButton";

type SortKey = "name" | "position" | "status" | "requested" | "flags" | "scheduled" | "updated";

/**
 * The response dashboard table (PLAN §10): all submissions, searchable and
 * sortable, each row opening the per-student view. Client-side filter/sort is
 * fine at roster scale (~400 rows); the server hands the full list once.
 */
export function ResponseList({ rows }: { rows: ResponseRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<1 | -1>(1);

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
    const sorted = [...base].sort((a, b) => dir * compare(a, b, sort));
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
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px" }}>
        <input
          type="search"
          placeholder="Search name, email, position…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: "1 1 280px",
            padding: "8px 10px",
            borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-secondary)",
            fontSize: 14,
          }}
        />
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {filtered.length} of {rows.length} · {scheduledCount} scheduled · {flaggedCount} flagged
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-secondary)", fontSize: 13 }}>
              <Th onClick={() => toggleSort("name")}>Name{arrow("name")}</Th>
              <Th onClick={() => toggleSort("position")}>Position{arrow("position")}</Th>
              <Th onClick={() => toggleSort("status")}>Status{arrow("status")}</Th>
              <Th onClick={() => toggleSort("requested")} align="right">
                Requested{arrow("requested")}
              </Th>
              <Th onClick={() => toggleSort("flags")} align="center">
                Flags{arrow("flags")}
              </Th>
              <Th onClick={() => toggleSort("scheduled")} align="center">
                Scheduled{arrow("scheduled")}
              </Th>
              <Th onClick={() => toggleSort("updated")} align="right">
                Updated{arrow("updated")}
              </Th>
              <th style={{ padding: "6px 10px" }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.email}
                onClick={() => router.push(`/admin/students/${encodeURIComponent(r.email)}`)}
                style={{ borderTop: "0.5px solid var(--color-border-tertiary)", cursor: "pointer" }}
              >
                <td style={td}>
                  <div style={{ fontWeight: 500 }}>{r.displayName}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{r.email}</div>
                </td>
                <td style={td}>{r.positionName ?? "—"}</td>
                <td style={td}>
                  <span style={r.status === "submitted" ? submittedBadge : draftBadge}>
                    {r.status}
                  </span>
                </td>
                <td style={{ ...td, textAlign: "right" }}>{r.desiredHours ? `${r.desiredHours}h` : "—"}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  {r.flagCount > 0 ? (
                    <span style={flagBadge}>⚠ {r.flagCount}</span>
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  {r.scheduled ? (
                    <span style={{ color: "var(--color-text-success)" }}>✓</span>
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: "right", color: "var(--color-text-tertiary)", fontSize: 13 }}>
                  {fmtDate(r.submittedAt ?? r.updatedAt)}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <DeleteResponseButton
                    studentEmail={r.email}
                    displayName={r.displayName}
                    variant="icon"
                  />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...td, color: "var(--color-text-tertiary)", textAlign: "center" }}>
                  No matching responses.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function compare(a: ResponseRow, b: ResponseRow, key: SortKey): number {
  switch (key) {
    case "name":
      return a.displayName.localeCompare(b.displayName);
    case "position":
      return (a.positionName ?? "").localeCompare(b.positionName ?? "");
    case "status":
      return a.status.localeCompare(b.status);
    case "requested":
      return (a.desiredHours ?? 0) - (b.desiredHours ?? 0);
    case "flags":
      return a.flagCount - b.flagCount;
    case "scheduled":
      return Number(a.scheduled) - Number(b.scheduled);
    case "updated":
      return (
        (a.submittedAt ?? a.updatedAt).getTime() - (b.submittedAt ?? b.updatedAt).getTime()
      );
  }
}

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Th({
  children,
  onClick,
  align = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      onClick={onClick}
      style={{ padding: "6px 10px", cursor: "pointer", textAlign: align, userSelect: "none", whiteSpace: "nowrap" }}
    >
      {children}
    </th>
  );
}

const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const badge: React.CSSProperties = { borderRadius: 10, padding: "1px 8px", fontSize: 12 };
const submittedBadge: React.CSSProperties = { ...badge, background: "#e6f4ea", color: "var(--color-text-success)" };
const draftBadge: React.CSSProperties = { ...badge, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" };
const flagBadge: React.CSSProperties = { ...badge, background: "var(--color-background-warning)", color: "var(--color-text-warning)" };
