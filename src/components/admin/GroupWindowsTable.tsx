"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { windowState, type WindowState } from "@/lib/domain/window";
import {
  createGroup,
  renameGroup,
  setGroupWindow,
  deleteGroup,
} from "@/lib/groups/actions";

export interface GroupView {
  id: string;
  name: string;
  isDefault: boolean;
  memberCount: number;
  opensAtMs: number | null;
  closesAtMs: number | null;
}

/** Group list with inline window scheduling, rename, create, and delete (PLAN §13). */
export function GroupWindowsTable({ groups }: { groups: GroupView[] }) {
  return (
    <section style={card}>
      <h2 style={h2}>Groups</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--color-text-secondary)", fontSize: 13 }}>
            <th style={th}>Group</th>
            <th style={th}>Members</th>
            <th style={th}>Opens</th>
            <th style={th}>Closes</th>
            <th style={th}>Status</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRow key={g.id} group={g} />
          ))}
        </tbody>
      </table>
      <CreateGroup />
    </section>
  );
}

function GroupRow({ group }: { group: GroupView }) {
  const router = useRouter();
  const [opens, setOpens] = useState(toLocalInput(group.opensAtMs));
  const [closes, setCloses] = useState(toLocalInput(group.closesAtMs));
  const [name, setName] = useState(group.name);
  const [editingName, setEditingName] = useState(false);
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
    <tr style={{ borderTop: "0.5px solid var(--color-border-secondary)" }}>
      <td style={td}>
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
            <button type="button" onClick={() => setEditingName(true)} style={linkBtn}>
              rename
            </button>
          </>
        )}
      </td>
      <td style={td}>{group.memberCount}</td>
      <td style={td}>
        <input
          type="datetime-local"
          value={opens}
          onChange={(e) => setOpens(e.target.value)}
          style={input}
        />
      </td>
      <td style={td}>
        <input
          type="datetime-local"
          value={closes}
          onChange={(e) => setCloses(e.target.value)}
          style={input}
        />
      </td>
      <td style={td}>
        <StatusChip state={state} />
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act(
              () => setGroupWindow(group.id, localInputToIso(opens), localInputToIso(closes)),
              "Window saved.",
            )
          }
        >
          Save window
        </button>{" "}
        {!group.isDefault && (
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
    <span style={{ background: s.bg, color: s.color, borderRadius: 10, padding: "1px 8px", fontSize: 12 }}>
      {s.label}
    </span>
  );
}

// datetime-local <-> instant helpers (browser-local <-> UTC ISO).
function toLocalInput(ms: number | null): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // interpreted in the browser's local timezone
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const h2: React.CSSProperties = { fontSize: 16, marginTop: 0 };
const th: React.CSSProperties = { padding: "4px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "8px", verticalAlign: "top" };
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
