"use client";

import { useRouter } from "next/navigation";
import {
  FLAG_FILTER_OPTIONS,
  NO_POSITION,
  REVIEW_FILTER_OPTIONS,
  STARTED_MODE_OPTIONS,
  STATUS_FILTER_OPTIONS,
  UNGROUPED,
} from "@/lib/admin/response-filters";

/**
 * Group + position + flag + off-roster + submission-state + start-date filters for the
 * response dashboard (roadmap 2.2). These live in the URL (not client state) so they
 * survive navigation into the per-student view and drive its prev/next walk. Search +
 * sort stay client-side in the table.
 */
export function ResponseFilterBar({
  groups,
  group,
  positions,
  position,
  flag,
  roster,
  status,
  started,
  startedDate,
  review,
}: {
  groups: { id: string; name: string }[];
  group?: string;
  positions: { id: string; name: string }[];
  position?: string;
  flag?: string;
  roster?: string;
  /** The parsed value, so an old `all=1` link still shows the right option. */
  status?: string;
  started?: string;
  startedDate?: string;
  review?: string;
}) {
  const router = useRouter();

  function navigate(next: {
    group?: string;
    position?: string;
    flag?: string;
    roster?: string;
    status?: string;
    started?: string;
    startedDate?: string;
    review?: string;
  }) {
    const params = new URLSearchParams();
    const g = next.group ?? group ?? "";
    const p = next.position ?? position ?? "";
    const f = next.flag ?? flag ?? "";
    const r = next.roster ?? roster ?? "";
    const st = next.status ?? status ?? "";
    const sm = next.started ?? started ?? "";
    const sd = next.startedDate ?? startedDate ?? "";
    const rv = next.review ?? review ?? "";
    if (g && g !== "all") params.set("group", g);
    if (p && p !== "all") params.set("position", p);
    if (f) params.set("flag", f);
    if (r === "all") params.set("roster", r);
    if (st) params.set("status", st);
    if (rv) params.set("review", rv);
    // A mode with no date yet stays in the URL so the date picker shows up;
    // the parser ignores the half-set pair until both halves are present.
    if (sm) {
      params.set("started", sm);
      if (sd) params.set("startedDate", sd);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/responses?${qs}` : "/admin/responses");
  }

  return (
    <div
      // No margin of its own: the response list renders this inside its control
      // panel and owns the spacing around it.
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <label style={labelStyle}>
        Group
        <select
          value={group ?? ""}
          onChange={(e) => navigate({ group: e.target.value })}
          style={selectStyle}
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value={UNGROUPED}>No group</option>
        </select>
      </label>

      <label style={labelStyle}>
        Position
        <select
          value={position ?? ""}
          onChange={(e) => navigate({ position: e.target.value })}
          style={selectStyle}
        >
          <option value="">All positions</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={NO_POSITION}>No position</option>
        </select>
      </label>

      <label style={labelStyle}>
        Flags
        <select
          value={flag ?? ""}
          onChange={(e) => navigate({ flag: e.target.value })}
          style={selectStyle}
        >
          {FLAG_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Review
        <select
          value={review ?? ""}
          onChange={(e) => navigate({ review: e.target.value })}
          style={selectStyle}
        >
          {REVIEW_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Started
        <select
          value={started ?? ""}
          onChange={(e) =>
            // Clearing the mode clears the date too, so no stale date lingers.
            navigate(
              e.target.value ? { started: e.target.value } : { started: "", startedDate: "" },
            )
          }
          style={selectStyle}
        >
          {STARTED_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {started && (
          <input
            type="date"
            value={startedDate ?? ""}
            onChange={(e) => navigate({ startedDate: e.target.value })}
            style={selectStyle}
          />
        )}
      </label>

      {/* "Submission", not "Show": the off-roster checkbox next door already
          leads with Show, and two controls opening the same way read as one. */}
      <label style={labelStyle}>
        Submission
        <select
          value={status ?? ""}
          onChange={(e) => navigate({ status: e.target.value })}
          style={selectStyle}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        <input
          type="checkbox"
          checked={roster === "all"}
          onChange={(e) => navigate({ roster: e.target.checked ? "all" : "" })}
        />
        Show off-roster
      </label>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  color: "var(--color-text-secondary)",
};

const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontSize: 14,
  background: "var(--color-background-primary)",
  fontFamily: "var(--font-sans)",
};
