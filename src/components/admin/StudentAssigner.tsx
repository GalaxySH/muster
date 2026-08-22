"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  searchStudentsForPicker,
  assignStudents,
  assignByPaste,
  unassignStudents,
} from "@/lib/groups/actions";
import type { PickerStudent, PickerFilters } from "@/lib/groups/data";
import { STARTED_MODE_OPTIONS } from "@/lib/admin/response-filters";
import type { StartedMode } from "@/lib/domain/calendar-day";

interface Option {
  id: string;
  name: string;
}

/**
 * Assign students to groups (PLAN §13): a filterable picker (position / roster /
 * group / hire date / name) with multi-select, plus a paste-a-list-of-emails path
 * that reports matched vs. unknown addresses. The hire-date filter (3 compare
 * options + a date) mirrors the response dashboard's start-date filter.
 */
export function StudentAssigner({ groups, positions }: { groups: Option[]; positions: Option[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Filters (dropdowns reload immediately; the name search applies on click).
  const [posSel, setPosSel] = useState("");
  const [rosterSel, setRosterSel] = useState("");
  const [groupSel, setGroupSel] = useState("");
  const [hiredMode, setHiredMode] = useState("");
  const [hiredDate, setHiredDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const [students, setStudents] = useState<PickerStudent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [target, setTarget] = useState(groups[0]?.id ?? "");
  const [paste, setPaste] = useState("");
  const [pasteTarget, setPasteTarget] = useState(groups[0]?.id ?? "");

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    const filters: PickerFilters = {};
    if (posSel) filters.positionId = posSel as PickerFilters["positionId"];
    if (rosterSel) filters.onRoster = rosterSel === "yes";
    if (groupSel) filters.groupId = groupSel as PickerFilters["groupId"];
    if (hiredMode && hiredDate)
      filters.hiredOn = { mode: hiredMode as StartedMode, date: hiredDate };
    if (appliedSearch.trim()) filters.search = appliedSearch.trim();
    setLoading(true);
    startTransition(async () => {
      const rows = await searchStudentsForPicker(filters);
      setStudents(rows);
      setSelected(new Set());
      setLoading(false);
    });
  }, [posSel, rosterSel, groupSel, hiredMode, hiredDate, appliedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleOne(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === students.length ? new Set() : new Set(students.map((s) => s.email)),
    );
  }

  function assignSelected() {
    setMsg(null);
    startTransition(async () => {
      const res = await assignStudents([...selected], target);
      setMsg({
        ok: res.ok,
        text: res.ok
          ? `Assigned ${selected.size} student${selected.size === 1 ? "" : "s"}.`
          : (res.error ?? "Failed."),
      });
      if (res.ok) {
        load();
        router.refresh();
      }
    });
  }

  function unassignSelected() {
    setMsg(null);
    startTransition(async () => {
      const res = await unassignStudents([...selected]);
      setMsg({
        ok: res.ok,
        text: res.ok ? `Removed ${selected.size} from their group.` : (res.error ?? "Failed."),
      });
      if (res.ok) {
        load();
        router.refresh();
      }
    });
  }

  function assignPasted() {
    setMsg(null);
    startTransition(async () => {
      const res = await assignByPaste(paste, pasteTarget);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Failed." });
        return;
      }
      const parts = [`Assigned ${res.assigned}.`];
      if (res.unmatched.length)
        parts.push(`${res.unmatched.length} not on roster: ${res.unmatched.join(", ")}`);
      if (res.invalid.length)
        parts.push(`${res.invalid.length} invalid: ${res.invalid.join(", ")}`);
      setMsg({ ok: true, text: parts.join(" ") });
      setPaste("");
      load();
      router.refresh();
    });
  }

  const allChecked = students.length > 0 && selected.size === students.length;

  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Assign students</h2>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <select value={posSel} onChange={(e) => setPosSel(e.target.value)} style={ctrl}>
          <option value="">Any position</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="none">No position</option>
        </select>
        <select value={rosterSel} onChange={(e) => setRosterSel(e.target.value)} style={ctrl}>
          <option value="">Any roster status</option>
          <option value="yes">On roster</option>
          <option value="no">Off roster</option>
        </select>
        <select value={groupSel} onChange={(e) => setGroupSel(e.target.value)} style={ctrl}>
          <option value="">Any group</option>
          <option value="none">Ungrouped</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={hiredMode}
          onChange={(e) => {
            const next = e.target.value;
            setHiredMode(next);
            if (!next) setHiredDate("");
          }}
          style={ctrl}
        >
          {STARTED_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value ? `Hired ${o.label.toLowerCase()}` : "Any hire date"}
            </option>
          ))}
        </select>
        {hiredMode && (
          <input
            type="date"
            value={hiredDate}
            onChange={(e) => setHiredDate(e.target.value)}
            style={ctrl}
          />
        )}
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setAppliedSearch(searchText)}
          placeholder="Search name/email"
          style={ctrl}
        />
        <button type="button" onClick={() => setAppliedSearch(searchText)}>
          Search
        </button>
      </div>

      {/* Student list */}
      <div
        style={{
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-md)",
          maxHeight: 320,
          overflow: "auto",
        }}
      >
        <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-secondary)" }}>
              <th style={th}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="select all"
                />
              </th>
              <th style={th}>Name</th>
              <th style={th}>Email</th>
              <th style={th}>Position</th>
              <th style={th}>Group</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={td} colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : students.length === 0 ? (
              <tr>
                <td style={td} colSpan={5}>
                  No students match these filters.
                </td>
              </tr>
            ) : (
              students.map((s) => (
                <tr
                  key={s.email}
                  style={{ borderTop: "0.5px solid var(--color-border-secondary)" }}
                >
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={selected.has(s.email)}
                      onChange={() => toggleOne(s.email)}
                      aria-label={`select ${s.email}`}
                    />
                  </td>
                  <td style={td}>{s.displayName}</td>
                  <td style={td}>{s.email}</td>
                  <td style={td}>{s.positionName ?? "—"}</td>
                  <td style={td}>
                    {s.groupName ?? (
                      <span style={{ color: "var(--color-text-tertiary)" }}>none</span>
                    )}
                    {s.groupAssignedAuto && s.groupName && (
                      <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>
                        {" "}
                        (auto)
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}
      >
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {selected.size} selected →
        </span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={ctrl}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={assignSelected}
          disabled={pending || selected.size === 0 || !target}
        >
          Assign to group
        </button>
        <button type="button" onClick={unassignSelected} disabled={pending || selected.size === 0}>
          Remove from group
        </button>
      </div>

      {/* Paste path */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Or paste a list of emails</h3>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder="a@wisc.edu, b@wisc.edu  c@wisc.edu …"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: 8,
            fontFamily: "var(--font-sans)",
            fontSize: 13,
          }}
        />
        <div
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}
        >
          <select value={pasteTarget} onChange={(e) => setPasteTarget(e.target.value)} style={ctrl}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={assignPasted}
            disabled={pending || !paste.trim() || !pasteTarget}
          >
            Assign pasted emails
          </button>
        </div>
      </div>

      {msg && (
        <p
          role="status"
          style={{
            margin: "10px 0 0",
            fontSize: 13,
            color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
          }}
        >
          {msg.ok ? "✓ " : "✗ "}
          {msg.text}
        </p>
      )}
    </section>
  );
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const ctrl: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
};
const th: React.CSSProperties = {
  padding: "6px 8px",
  fontWeight: 500,
  position: "sticky",
  top: 0,
  background: "var(--color-background-primary)",
};
const td: React.CSSProperties = { padding: "6px 8px" };
