"use client";

/**
 * How the working term's roster tracker is read (docs/semester-domains-plan.md
 * §2.4): the sheets to look for, the titles that mean admin, and the header
 * names of columns. Stored on the term, so a new semester's tracker can be
 * renamed or reworded without a code change. A blank column name keeps the
 * built-in header matching.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "./RenderedTerm";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui";
import { setRosterReading } from "@/lib/admin/actions";
import type { RosterColumns, RosterReadingInput } from "@/lib/roster/config";

const COLUMN_FIELDS: { key: keyof RosterColumns; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "title", label: "Title" },
  { key: "international", label: "International" },
  { key: "startDate", label: "Start date" },
];

export function RosterReadingPanel({ reading }: { reading: RosterReadingInput }) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [draft, setDraft] = useState(reading);
  const [pending, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(reading);
  const set = <K extends keyof RosterReadingInput>(k: K, v: RosterReadingInput[K]) => {
    setMsg(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await setRosterReading(termId, draft);
      setMsg(
        res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Could not save." },
      );
      if (res.ok) router.refresh();
    });
  }

  return (
    <div>
      <div style={grid}>
        <label style={field}>
          <span style={labelText}>Sheets to read</span>
          <textarea
            value={draft.sheetCandidates}
            rows={2}
            onChange={(e) => set("sheetCandidates", e.target.value)}
            style={input}
          />
          <span style={hint}>One per line. The first one found in the file is read.</span>
        </label>
        <label style={field}>
          <span style={labelText}>Leaving sheet</span>
          <input
            type="text"
            value={draft.leavingSheet}
            onChange={(e) => set("leavingSheet", e.target.value)}
            style={input}
          />
          <span style={hint}>Read for resignation dates only.</span>
        </label>
        <label style={field}>
          <span style={labelText}>Admin titles</span>
          <textarea
            value={draft.adminTitles}
            rows={2}
            onChange={(e) => set("adminTitles", e.target.value)}
            style={input}
          />
          <span style={hint}>One per line. People with these titles become admins.</span>
        </label>
      </div>

      <h3 style={{ fontSize: 14, margin: "16px 0 4px" }}>Column names</h3>
      <p style={{ ...hint, margin: "0 0 8px" }}>
        Leave a column blank to find it automatically. Fill one in if the tracker calls it something
        else.
      </p>
      <div style={grid}>
        {COLUMN_FIELDS.map(({ key, label }) => (
          <label key={key} style={field}>
            <span style={labelText}>{label}</span>
            <input
              type="text"
              value={draft.columns[key]}
              placeholder="Automatic"
              onChange={(e) => set("columns", { ...draft.columns, [key]: e.target.value })}
              style={input}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <ActionButton onClick={save} pending={pending} pendingLabel="Saving…" disabled={!dirty}>
          Save roster settings
        </ActionButton>
        {msg && (
          <span
            role="status"
            style={{
              fontSize: 13,
              color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
            }}
          >
            {msg.ok ? "✓ " : "✗ "}
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
  alignItems: "start",
};
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 13, color: "var(--color-text-secondary)" };
const input: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
  width: "100%",
};
