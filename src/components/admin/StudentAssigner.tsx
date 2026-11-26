"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
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
import { ActionMessage, Button, Panel } from "@/components/admin/ui";

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
  const termId = useRenderedTermId();
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
      const res = await unassignStudents([...selected], termId);
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
    <Panel flush title="Assign students">
      <div className="ad-toolbar">
        <select
          value={posSel}
          onChange={(e) => setPosSel(e.target.value)}
          aria-label="Filter by position"
        >
          <option value="">Any position</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="none">No position</option>
        </select>
        <select
          value={rosterSel}
          onChange={(e) => setRosterSel(e.target.value)}
          aria-label="Filter by roster status"
        >
          <option value="">Any roster status</option>
          <option value="yes">On roster</option>
          <option value="no">Off roster</option>
        </select>
        <select
          value={groupSel}
          onChange={(e) => setGroupSel(e.target.value)}
          aria-label="Filter by group"
        >
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
          aria-label="Filter by hire date"
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
            aria-label="Hire date"
          />
        )}
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setAppliedSearch(searchText)}
          placeholder="Search name/email"
          aria-label="Search name or email"
        />
        <Button onClick={() => setAppliedSearch(searchText)}>Search</Button>
      </div>

      <div className="ad-su-scroll">
        <table className="ad-table ad-table--stack">
          <thead>
            <tr>
              <th scope="col" className="ad-check-col">
                <label className="ad-check-hit">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="select all"
                  />
                </label>
              </th>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Position</th>
              <th scope="col">Group</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5}>Loading…</td>
              </tr>
            ) : students.length === 0 ? (
              <tr>
                <td colSpan={5}>No students match these filters.</td>
              </tr>
            ) : (
              students.map((s) => (
                <tr key={s.email}>
                  <td>
                    <label className="ad-check-hit">
                      <input
                        type="checkbox"
                        checked={selected.has(s.email)}
                        onChange={() => toggleOne(s.email)}
                        aria-label={`select ${s.email}`}
                      />
                    </label>
                  </td>
                  <td data-label="Name">{s.displayName}</td>
                  <td data-label="Email">{s.email}</td>
                  <td data-label="Position">
                    {s.positionName ?? <span className="ad-faint">none</span>}
                  </td>
                  <td data-label="Group">
                    {s.groupName ?? <span className="ad-faint">none</span>}
                    {s.groupAssignedAuto && s.groupName && (
                      <span className="ad-faint ad-small"> (auto)</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="ad-row ad-panel-pad ad-panel-pad--top">
        <span className="ad-muted">{selected.size} selected →</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Group to assign the selected students to"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          onClick={assignSelected}
          disabled={pending || selected.size === 0 || !target}
        >
          Assign to group
        </Button>
        <Button onClick={unassignSelected} disabled={pending || selected.size === 0}>
          Remove from group
        </Button>
      </div>

      <div className="ad-panel-pad ad-panel-pad--top">
        <h3>Or paste a list of emails</h3>
        <textarea
          className="ad-input--block"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder="a@wisc.edu, b@wisc.edu  c@wisc.edu …"
          aria-label="Emails to assign"
        />
        <div className="ad-actions">
          <select
            value={pasteTarget}
            onChange={(e) => setPasteTarget(e.target.value)}
            aria-label="Group to assign the pasted emails to"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <Button onClick={assignPasted} disabled={pending || !paste.trim() || !pasteTarget}>
            Assign pasted emails
          </Button>
        </div>
        {msg && (
          <ActionMessage ok={msg.ok} as="p" className="ad-su-below ad-prewrap">
            {msg.text}
          </ActionMessage>
        )}
      </div>
    </Panel>
  );
}
