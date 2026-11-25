"use client";

/**
 * The Semester page's editor for the working term's name, dates, new hire date
 * and schedule note. The travel cutoff has its own panel below it.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui";
import { saveTermDetails } from "@/lib/admin/term-actions";
import { MAX_CLOSE_REQUIREMENT } from "@/lib/domain/close-claims";
import {
  SCHEDULE_NOTE_MAX,
  TERM_NAME_MAX,
  cleanTermDetails,
  type TermDetails,
} from "@/lib/domain/terms";

export function TermDetailsForm({ details }: { details: TermDetails }) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [draft, setDraft] = useState(details);
  const [pending, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(details);
  const set = <K extends keyof TermDetails>(k: K, v: TermDetails[K]) => {
    setMsg(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await saveTermDetails(termId, draft);
      setMsg(
        res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Could not save." },
      );
      if (res.ok) {
        // Show what was stored: the name and note are tidied on save.
        setDraft(cleanTermDetails(draft));
        router.refresh();
      }
    });
  }

  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Details</h2>
      <div style={grid}>
        <label style={field}>
          <span style={labelText}>Name</span>
          <input
            type="text"
            value={draft.name}
            maxLength={TERM_NAME_MAX}
            onChange={(e) => set("name", e.target.value)}
            style={input}
          />
        </label>
        <label style={field}>
          <span style={labelText}>First day</span>
          <input
            type="date"
            value={draft.startsOn}
            onChange={(e) => set("startsOn", e.target.value)}
            style={input}
          />
        </label>
        <label style={field}>
          <span style={labelText}>Last day</span>
          <input
            type="date"
            value={draft.endsOn}
            onChange={(e) => set("endsOn", e.target.value)}
            style={input}
          />
        </label>
        <label style={field}>
          <span style={labelText}>New hires start on</span>
          <input
            type="date"
            value={draft.newHireCutoff}
            onChange={(e) => set("newHireCutoff", e.target.value)}
            style={input}
          />
          <span style={hint}>Anyone hired on or after this date counts as a new hire.</span>
        </label>
        <label style={field}>
          <span style={labelText}>Closes per Shift Lead</span>
          <input
            type="number"
            min={0}
            max={MAX_CLOSE_REQUIREMENT}
            step={1}
            value={Number.isNaN(draft.closeRequirement) ? "" : draft.closeRequirement}
            onChange={(e) => set("closeRequirement", e.target.valueAsNumber)}
            style={input}
          />
          <span style={hint}>
            New Shift Leads start with this many weekend closes. Change a lead&apos;s own number
            on the Closes page.
          </span>
        </label>
      </div>
      <label style={{ ...field, marginTop: 14 }}>
        <span style={labelText}>Schedule note</span>
        <textarea
          value={draft.scheduleNote}
          maxLength={SCHEDULE_NOTE_MAX}
          rows={2}
          onChange={(e) => set("scheduleNote", e.target.value)}
          style={{ ...input, fontFamily: "inherit", width: "100%" }}
        />
        <span style={hint}>Students see this when they finish the form.</span>
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <ActionButton onClick={save} pending={pending} pendingLabel="Saving…" disabled={!dirty}>
          Save details
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
    </section>
  );
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 14,
  alignItems: "start",
};
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 13, color: "var(--color-text-secondary)" };
const input: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  boxSizing: "border-box",
};
