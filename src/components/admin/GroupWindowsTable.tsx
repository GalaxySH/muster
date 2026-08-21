"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { localDay } from "@/lib/domain/calendar-day";
import { windowState, type WindowState } from "@/lib/domain/window";
import {
  createGroup,
  renameGroup,
  setGroupWindow,
  setGroupLockAfterSubmit,
  setDefaultGroup,
  deleteGroup,
} from "@/lib/groups/actions";
import { CopyEmailsButton } from "@/components/admin/CopyEmailsButton";
import { TEST_GROUP_ID } from "@/lib/test-accounts/constants";

export interface GroupView {
  id: string;
  name: string;
  isDefault: boolean;
  memberCount: number;
  memberEmails: string[];
  opensAtMs: number | null;
  closesAtMs: number | null;
  lockAfterSubmit: boolean;
}

/** Group list with inline window scheduling, rename, create, and delete (PLAN §13). */
export function GroupWindowsTable({ groups }: { groups: GroupView[] }) {
  return (
    <section style={card}>
      <h2 style={h2}>Groups</h2>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--color-text-secondary)" }}>
        Pick the open and close dates. The window starts and ends at{" "}
        <strong>00:00 (midnight)</strong> on each date. <strong>No edit</strong> keeps accepting new
        submissions while open but makes each student read-only once they finish.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="stack-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Members</th>
              <th>Opens</th>
              <th>Closes</th>
              <th>Status</th>
              <th>After submit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRow key={g.id} group={g} />
            ))}
          </tbody>
        </table>
      </div>
      <CreateGroup />
    </section>
  );
}

function GroupRow({ group }: { group: GroupView }) {
  const router = useRouter();
  const isTestGroup = group.id === TEST_GROUP_ID;
  const [opens, setOpens] = useState(toLocalInput(group.opensAtMs));
  const [closes, setCloses] = useState(toLocalInput(group.closesAtMs));
  const [name, setName] = useState(group.name);
  const [editingName, setEditingName] = useState(false);
  const [lockAfterSubmit, setLockAfterSubmit] = useState(group.lockAfterSubmit);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const state = windowState(
    group.opensAtMs ? new Date(group.opensAtMs) : null,
    group.closesAtMs ? new Date(group.closesAtMs) : null,
    new Date(),
  );

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? okText : (res.error ?? "Failed.") });
      if (res.ok) router.refresh();
    });
  }

  function saveWindow() {
    const isoOpens = localInputToIso(opens);
    const isoCloses = localInputToIso(closes);
    const hadWindow = group.opensAtMs != null && group.closesAtMs != null;
    // A `datetime-local` input yields an empty string unless BOTH a date and a
    // time are entered, so picking only dates silently produces no value. Guard
    // that here: if neither bound is set and there's no existing window to clear,
    // the admin almost certainly meant to schedule one but left the time blank.
    if (!isoOpens && !isoCloses && !hadWindow) {
      setMsg({ ok: false, text: "Pick a date for both Opens and Closes." });
      return;
    }
    if (Boolean(isoOpens) !== Boolean(isoCloses)) {
      setMsg({ ok: false, text: "Set both an open and a close date, or clear both." });
      return;
    }
    act(
      () => setGroupWindow(group.id, isoOpens, isoCloses),
      isoOpens ? "Window saved." : "Window cleared.",
    );
  }

  function toggleLockAfterSubmit(next: boolean) {
    setLockAfterSubmit(next); // optimistic
    setMsg(null);
    startTransition(async () => {
      const res = await setGroupLockAfterSubmit(group.id, next);
      if (res.ok) {
        router.refresh();
      } else {
        setLockAfterSubmit(!next); // revert on failure
        setMsg({ ok: false, text: res.error ?? "Failed." });
      }
    });
  }

  function saveName() {
    setMsg(null);
    startTransition(async () => {
      const res = await renameGroup(group.id, name);
      setMsg({ ok: res.ok, text: res.ok ? "Renamed." : (res.error ?? "Failed.") });
      if (res.ok) {
        setEditingName(false);
        router.refresh();
      }
    });
  }

  return (
    <tr>
      <td data-label="Group">
        {editingName ? (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
            <button type="button" disabled={pending} onClick={saveName}>
              Save
            </button>
          </span>
        ) : (
          <>
            <strong>{group.name}</strong>
            {group.isDefault && <span style={badge}>default</span>}
            {isTestGroup && <span style={badge}>test accounts</span>}
            <button type="button" onClick={() => setEditingName(true)} style={linkBtn}>
              rename
            </button>
            {!group.isDefault && !isTestGroup && (
              <button
                type="button"
                disabled={pending}
                style={linkBtn}
                onClick={() => {
                  if (
                    confirm(
                      `Make "${group.name}" the default group? New/ungrouped students will be swept into it instead.`,
                    )
                  ) {
                    act(() => setDefaultGroup(group.id), "Now the default group.");
                  }
                }}
              >
                make default
              </button>
            )}
          </>
        )}
      </td>
      <td data-label="Members" style={{ whiteSpace: "nowrap" }}>
        {group.memberCount}
        {group.memberEmails.length > 0 && (
          <>
            {" "}
            <CopyEmailsButton emails={group.memberEmails} label="copy emails" />
          </>
        )}
      </td>
      <td data-label="Opens">
        <input type="date" value={opens} onChange={(e) => setOpens(e.target.value)} style={input} />
      </td>
      <td data-label="Closes">
        <input
          type="date"
          value={closes}
          onChange={(e) => setCloses(e.target.value)}
          style={input}
        />
      </td>
      <td data-label="Status">
        <StatusChip state={state} />
      </td>
      <td data-label="After submit">
        <label
          style={{
            display: "inline-flex",
            gap: 6,
            alignItems: "center",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="checkbox"
            checked={lockAfterSubmit}
            disabled={pending}
            onChange={(e) => toggleLockAfterSubmit(e.target.checked)}
          />
          No edit
        </label>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button type="button" disabled={pending} onClick={saveWindow}>
          Save window
        </button>{" "}
        {!group.isDefault && !isTestGroup && (
          <button
            type="button"
            disabled={pending}
            style={{ color: "var(--color-text-danger)" }}
            onClick={() => {
              if (confirm(`Delete group "${group.name}"? Its members become ungrouped.`)) {
                act(() => deleteGroup(group.id), "Deleted.");
              }
            }}
          >
            Delete
          </button>
        )}
        {msg && (
          <div
            style={{
              fontSize: 12,
              marginTop: 4,
              color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
            }}
          >
            {msg.ok ? "✓ " : "✗ "}
            {msg.text}
          </div>
        )}
      </td>
    </tr>
  );
}

function CreateGroup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function create() {
    setErr(null);
    startTransition(async () => {
      const res = await createGroup(name);
      if (res.ok) {
        setName("");
        router.refresh();
      } else {
        setErr(res.error ?? "Failed.");
      }
    });
  }

  return (
    <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New group name"
        style={input}
      />
      <button type="button" onClick={create} disabled={pending || !name.trim()}>
        Create group
      </button>
      {err && <span style={{ color: "var(--color-text-danger)", fontSize: 13 }}>{err}</span>}
    </div>
  );
}

function StatusChip({ state }: { state: WindowState }) {
  const map: Record<WindowState, { label: string; color: string; bg: string }> = {
    open: { label: "open", color: "#196127", bg: "#e6f4ea" },
    before: { label: "opens later", color: "#946c00", bg: "#fff4d6" },
    closed: { label: "closed", color: "#b00", bg: "#fce8e6" },
    unconfigured: { label: "not scheduled", color: "#555", bg: "#eee" },
  };
  const s = map[state];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        borderRadius: 10,
        padding: "1px 8px",
        fontSize: 12,
      }}
    >
      {s.label}
    </span>
  );
}

// date <-> instant helpers (shared with TravelCutoffPanel). The input is a
// calendar date; the time defaults to 00:00 in the browser's local timezone, so
// the window opens/closes at the start of the chosen day. Round-trips through a
// UTC ISO instant for storage.
export function toLocalInput(ms: number | null): string {
  return ms == null ? "" : localDay(new Date(ms));
}
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00`); // local midnight on the chosen date
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const h2: React.CSSProperties = { fontSize: 16, marginTop: 0 };
const input: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
};
const badge: React.CSSProperties = {
  marginLeft: 8,
  background: "var(--color-background-secondary, #eef)",
  color: "var(--color-text-secondary)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
};
const linkBtn: React.CSSProperties = {
  marginLeft: 8,
  background: "none",
  border: "none",
  color: "var(--color-text-link, #1a66cc)",
  cursor: "pointer",
  fontSize: 12,
  padding: 0,
};
