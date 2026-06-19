"use client";

import { useState, useTransition } from "react";
import { saveSchedulerNotes } from "@/lib/admin/actions";

/** Free-text scheduler notes per student (PLAN §10a). Saves on demand. */
export function SchedulerNotes({
  studentEmail,
  initialNotes,
}: {
  studentEmail: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState<string | null>(initialNotes);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty = notes !== (saved ?? "");

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveSchedulerNotes(studentEmail, notes);
      if (res.ok) setSaved(notes);
      else setError(res.error ?? "Could not save.");
    });
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 6,
          fontSize: 13,
          color: "var(--color-text-secondary)",
        }}
      >
        <span>scheduling notes</span>
        {dirty && <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>unsaved</span>}
        {!dirty && saved && (
          <span style={{ color: "var(--color-text-success)", fontSize: 12 }}>✓ saved</span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="e.g. A weekend + Tue close; gave 5p–8:30p Mon/Wed…"
        rows={2}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: 8,
          resize: "vertical",
          borderRadius: "var(--border-radius-md)",
          border: "0.5px solid var(--color-border-secondary)",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
        }}
      />
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save notes"}
        </button>
        {error && <span style={{ color: "var(--color-text-danger)", fontSize: 13 }}>{error}</span>}
      </div>
    </div>
  );
}
