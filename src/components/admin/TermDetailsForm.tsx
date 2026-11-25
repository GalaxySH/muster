"use client";

/**
 * The Semester page's editor for the working term's name, dates, new hire date,
 * travel cutoff, schedule note and system message, all saved by one button.
 *
 * The travel cutoff (PLAN §8) is one instant per term, independent of the
 * per-group form windows: students can add travel entries until it, and the
 * late-travel toggle decides what happens after it. Off (default), the travel
 * step refuses new entries and locks the existing ones ("refuse" in
 * domain/travel.ts); on, entries stay accepted but are stored late and
 * unexcused ("accept-and-flag"). Reset puts the date back to the term's
 * default, the day before the semester starts. Nothing else moves the cutoff:
 * changing the semester's first day leaves it where it was set. Both travel
 * settings keep their own actions, which Save runs after `saveTermDetails`.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { ActionButton, SystemMessage } from "@/components/ui";
import { saveTermDetails } from "@/lib/admin/term-actions";
import { setLateTravelAccepted, setTravelCutoff } from "@/lib/admin/actions";
import { toLocalInput, localInputToIso } from "@/components/admin/GroupWindowsTable";
import { defaultTravelCutoff } from "@/lib/domain/travel";
import { MAX_CLOSE_REQUIREMENT } from "@/lib/domain/close-claims";
import {
  SCHEDULE_NOTE_MAX,
  SYSTEM_MESSAGE_MAX,
  SYSTEM_MESSAGE_TONES,
  TERM_NAME_MAX,
  cleanTermDetails,
  type SystemMessageTone,
  type TermDetails,
} from "@/lib/domain/terms";

const TONE_LABELS: Record<SystemMessageTone, string> = {
  info: "Blue",
  success: "Green",
  warning: "Yellow",
  danger: "Red",
};

/** The term's travel cutoff as stored, and whether late travel is accepted. */
export interface TravelSettings {
  cutoffMs: number;
  /** False while the cutoff is still the term's default. */
  isCustom: boolean;
  lateAccepted: boolean;
}

export function TermDetailsForm({
  details,
  travel,
}: {
  details: TermDetails;
  travel: TravelSettings;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [draft, setDraft] = useState(details);
  const savedCutoff = toLocalInput(travel.cutoffMs);
  const [cutoff, setCutoff] = useState(savedCutoff);
  // Set by Reset: the save puts the cutoff back to the term's default.
  const [resetCutoff, setResetCutoff] = useState(false);
  const [lateAccepted, setLateAccepted] = useState(travel.lateAccepted);
  const [pending, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const detailsDirty = JSON.stringify(draft) !== JSON.stringify(details);
  const cutoffDirty = resetCutoff || cutoff !== savedCutoff;
  const lateDirty = lateAccepted !== travel.lateAccepted;
  const dirty = detailsDirty || cutoffDirty || lateDirty;
  const set = <K extends keyof TermDetails>(k: K, v: TermDetails[K]) => {
    setMsg(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  function save() {
    setMsg(null);
    const cutoffIso = resetCutoff ? null : localInputToIso(cutoff);
    if (cutoffDirty && !resetCutoff && !cutoffIso) {
      setMsg({ ok: false, text: "Pick a travel cutoff date, or reset it to the default." });
      return;
    }
    startSave(async () => {
      // Details first: a reset cutoff is worked out from the first day just saved.
      const steps = [
        detailsDirty ? () => saveTermDetails(termId, draft) : null,
        cutoffDirty ? () => setTravelCutoff(termId, cutoffIso) : null,
        lateDirty ? () => setLateTravelAccepted(termId, lateAccepted) : null,
      ];
      for (const step of steps) {
        if (!step) continue;
        const res = await step();
        if (!res.ok) {
          setMsg({ ok: false, text: res.error ?? "Could not save." });
          router.refresh();
          return;
        }
      }
      setMsg({ ok: true, text: "Saved." });
      // Show what was stored: the name and note are tidied on save.
      setDraft(cleanTermDetails(draft));
      setResetCutoff(false);
      router.refresh();
    });
  }

  function resetToDefault() {
    setMsg(null);
    setResetCutoff(true);
    setCutoff(toLocalInput(defaultTravelCutoff(draft.startsOn).getTime()));
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
        <label style={field}>
          <span style={labelText}>Travel excusal cutoff</span>
          <input
            type="date"
            value={cutoff}
            onChange={(e) => {
              setMsg(null);
              setResetCutoff(false);
              setCutoff(e.target.value);
            }}
            style={input}
          />
          <span style={hint}>
            Students can add travel until midnight on this date, in every group.
            {!travel.isCustom &&
              !cutoffDirty &&
              " This is the default, the day before the semester starts."}
            {resetCutoff && " Back to the default once you save."}
            {travel.isCustom && !resetCutoff && (
              <>
                {" "}
                <button type="button" onClick={resetToDefault} style={linkButton}>
                  Reset to default
                </button>
              </>
            )}
          </span>
        </label>
      </div>
      <label style={lateToggle}>
        <input
          type="checkbox"
          checked={lateAccepted}
          onChange={(e) => {
            setMsg(null);
            setLateAccepted(e.target.checked);
          }}
        />
        <span>
          Accept late travel
          <span style={{ ...hint, display: "block" }}>
            Students can keep adding travel after the cutoff. Those entries are marked late and are
            not excused.
          </span>
        </span>
      </label>
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
      <label style={{ ...field, marginTop: 14 }}>
        <span style={labelText}>System message</span>
        <textarea
          value={draft.systemMessage}
          maxLength={SYSTEM_MESSAGE_MAX}
          rows={3}
          onChange={(e) => set("systemMessage", e.target.value)}
          style={{ ...input, fontFamily: "inherit", width: "100%" }}
        />
        <span style={hint}>
          Students see this at the top of their home page. Leave it empty to show no message.
        </span>
      </label>
      <label style={{ ...field, marginTop: 14, maxWidth: 190 }}>
        <span style={labelText}>Message color</span>
        <select
          value={draft.systemMessageTone}
          onChange={(e) => set("systemMessageTone", e.target.value as SystemMessageTone)}
          style={input}
        >
          {SYSTEM_MESSAGE_TONES.map((tone) => (
            <option key={tone} value={tone}>
              {TONE_LABELS[tone]}
            </option>
          ))}
        </select>
      </label>
      {draft.systemMessage.trim() && (
        <SystemMessage text={draft.systemMessage.trim()} tone={draft.systemMessageTone} />
      )}
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
const lateToggle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  marginTop: 14,
  fontSize: 14,
  cursor: "pointer",
};
const linkButton: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--color-text-link, #1a66cc)",
  cursor: "pointer",
  fontSize: 13,
};
const input: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  boxSizing: "border-box",
};
