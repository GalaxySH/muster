"use client";

import { useRouter } from "next/navigation";
import { FLAG_FILTER_OPTIONS, UNGROUPED } from "@/lib/admin/response-filters";

/**
 * Group + flag + off-roster filters for the response dashboard (roadmap 2.2).
 * These live in the URL (not client state) so they survive navigation into the
 * per-student view and drive its prev/next walk. Search + sort stay client-side
 * in the table.
 */
export function ResponseFilterBar({
  groups,
  group,
  flag,
  roster,
}: {
  groups: { id: string; name: string }[];
  group?: string;
  flag?: string;
  roster?: string;
}) {
  const router = useRouter();

  function navigate(next: { group?: string; flag?: string; roster?: string }) {
    const params = new URLSearchParams();
    const g = next.group ?? group ?? "";
    const f = next.flag ?? flag ?? "";
    const r = next.roster ?? roster ?? "";
    if (g && g !== "all") params.set("group", g);
    if (f) params.set("flag", f);
    if (r === "all") params.set("roster", r);
    const qs = params.toString();
    router.push(qs ? `/admin/responses?${qs}` : "/admin/responses");
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px" }}>
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
};
