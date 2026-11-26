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
 * changing the semester's first day leaves it where it was set. The second
 * toggle keeps the travel step open after a group's form closes, until the
 * cutoff, when the cutoff is the later of the two. The travel settings keep
 * their own actions, which Save runs after `saveTermDetails`.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { Notice as StudentNotice } from "@/components/student/ui";
import { ActionMessage, Button, CheckRow, Field, Panel } from "@/components/admin/ui";
import { saveTermDetails } from "@/lib/admin/term-actions";
import { setLateTravelAccepted, setTravelAfterClose, setTravelCutoff } from "@/lib/admin/actions";
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
  /** Keep the travel step open after the form closes, until the cutoff. */
  afterClose: boolean;
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
  const [afterClose, setAfterClose] = useState(travel.afterClose);
  const [pending, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const detailsDirty = JSON.stringify(draft) !== JSON.stringify(details);
  const cutoffDirty = resetCutoff || cutoff !== savedCutoff;
  const lateDirty = lateAccepted !== travel.lateAccepted;
  const afterCloseDirty = afterClose !== travel.afterClose;
  const dirty = detailsDirty || cutoffDirty || lateDirty || afterCloseDirty;
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
        afterCloseDirty ? () => setTravelAfterClose(termId, afterClose) : null,
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
    <Panel title="Details">
      <section className="ad-su-group ad-su-group--first">
        <h3 className="ad-minititle">Dates</h3>
        <div className="ad-fields">
          <Field label="Name" htmlFor="term-name">
            <input
              id="term-name"
              type="text"
              value={draft.name}
              maxLength={TERM_NAME_MAX}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="First day" htmlFor="term-starts">
            <input
              id="term-starts"
              type="date"
              value={draft.startsOn}
              onChange={(e) => set("startsOn", e.target.value)}
            />
          </Field>
          <Field label="Last day" htmlFor="term-ends">
            <input
              id="term-ends"
              type="date"
              value={draft.endsOn}
              onChange={(e) => set("endsOn", e.target.value)}
            />
          </Field>
          <Field
            label="New hires start on"
            htmlFor="term-new-hires"
            help="Anyone hired on or after this date counts as a new hire."
          >
            <input
              id="term-new-hires"
              type="date"
              value={draft.newHireCutoff}
              onChange={(e) => set("newHireCutoff", e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section id="closes" className="ad-su-group ad-anchor">
        <h3 className="ad-minititle">Shift Leads</h3>
        <div className="ad-su-medium">
          <Field
            label="Closes per Shift Lead"
            htmlFor="term-closes"
            help={
              <>
                New Shift Leads start with this many weekend closes. Change a lead&apos;s own number
                on the Closes page.
              </>
            }
          >
            <input
              id="term-closes"
              className="ad-su-narrow"
              type="number"
              min={0}
              max={MAX_CLOSE_REQUIREMENT}
              step={1}
              value={Number.isNaN(draft.closeRequirement) ? "" : draft.closeRequirement}
              onChange={(e) => set("closeRequirement", e.target.valueAsNumber)}
            />
          </Field>
        </div>
      </section>

      <section id="travel" className="ad-su-group ad-anchor">
        <h3 className="ad-minititle">Travel</h3>
        <div className="ad-su-medium">
          <Field
            label="Travel excusal cutoff"
            htmlFor="term-travel-cutoff"
            help={
              <>
                Students can add travel until midnight on this date, in every group.
                {!travel.isCustom &&
                  !cutoffDirty &&
                  " This is the default, the day before the semester starts."}
                {resetCutoff && " Back to the default once you save."}
                {travel.isCustom && !resetCutoff && (
                  <>
                    {" "}
                    <button type="button" onClick={resetToDefault} className="ad-linkbtn">
                      Reset to default
                    </button>
                  </>
                )}
              </>
            }
          >
            <input
              id="term-travel-cutoff"
              className="ad-su-narrow"
              type="date"
              value={cutoff}
              onChange={(e) => {
                setMsg(null);
                setResetCutoff(false);
                setCutoff(e.target.value);
              }}
            />
          </Field>
        </div>
        <div className="ad-stack ad-stack--tight ad-su-below">
          <CheckRow
            label="Accept late travel"
            help="Students can keep adding travel after the cutoff. Those entries are marked late and are not excused."
          >
            <input
              type="checkbox"
              checked={lateAccepted}
              onChange={(e) => {
                setMsg(null);
                setLateAccepted(e.target.checked);
              }}
            />
          </CheckRow>
          <CheckRow
            label="Keep travel open after the form closes"
            help={
              <>
                If the cutoff is after a group&apos;s close date, students in that group can still
                add travel until the cutoff. The rest of the form stays closed.
              </>
            }
          >
            <input
              type="checkbox"
              checked={afterClose}
              onChange={(e) => {
                setMsg(null);
                setAfterClose(e.target.checked);
              }}
            />
          </CheckRow>
        </div>
      </section>

      <section className="ad-su-group">
        <h3 className="ad-minititle">Messages</h3>
        <div className="ad-stack">
          <Field
            label="Schedule note"
            htmlFor="term-schedule-note"
            help="Students see this when they finish the form."
          >
            <textarea
              id="term-schedule-note"
              className="ad-input--block"
              value={draft.scheduleNote}
              maxLength={SCHEDULE_NOTE_MAX}
              rows={2}
              onChange={(e) => set("scheduleNote", e.target.value)}
            />
          </Field>
          <Field
            label="System message"
            htmlFor="term-system-message"
            help="Students see this at the top of their home page. Leave it empty to show no message."
          >
            <textarea
              id="term-system-message"
              className="ad-input--block"
              value={draft.systemMessage}
              maxLength={SYSTEM_MESSAGE_MAX}
              rows={3}
              onChange={(e) => set("systemMessage", e.target.value)}
            />
          </Field>
          <div className="ad-su-narrow">
            <Field label="Message color" htmlFor="term-message-tone">
              <select
                id="term-message-tone"
                value={draft.systemMessageTone}
                onChange={(e) => set("systemMessageTone", e.target.value as SystemMessageTone)}
              >
                {SYSTEM_MESSAGE_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {TONE_LABELS[tone]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {draft.systemMessage.trim() && (
            <div className="ad-field">
              <span className="ad-label">Preview</span>
              {/* The student design's own notice, as /me renders it. */}
              <div className="sf-scope ad-su-preview">
                <StudentNotice tone={draft.systemMessageTone} role="note">
                  <p className="sf-prewrap">{draft.systemMessage.trim()}</p>
                </StudentNotice>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="ad-actions">
        <Button
          variant="primary"
          size="md"
          onClick={save}
          pending={pending}
          pendingLabel="Saving…"
          disabled={!dirty}
        >
          Save details
        </Button>
        {msg && <ActionMessage ok={msg.ok}>{msg.text}</ActionMessage>}
      </div>
    </Panel>
  );
}
