"use client";

/**
 * The confirmation dialog for the "your schedule is posted" email, opened from
 * the Mark scheduled menu on the per-student page. The scheduler fills in the
 * start date (default: next Sunday) and a first-shift time if it's tomorrow,
 * checks the Preview tab (the student's current-run shifts included), and
 * sends. The Edit tab holds a copy of the saved template for this one email,
 * for one-off paragraphs like a cross-over shift; the saved template stays as
 * it is. Nothing is sent without the Send click here.
 *
 * Loaded on demand by MarkScheduledButton, so Liquid and the sanitizer only
 * download when the dialog opens.
 */
import { useId, useMemo, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { ActionMessage, Button, CheckRow, Field, Notice } from "@/components/admin/ui";
import { sendScheduleEmail } from "@/lib/admin/schedule-email-actions";
import { chicagoToday } from "@/lib/domain/time";
import {
  buildScheduleEmailVars,
  nextSunday,
  renderScheduleEmail,
  suggestFirstShiftTime,
  validateScheduleEmailInput,
  validateScheduleTemplate,
  type ScheduleEmailInput,
  type ScheduleEmailTemplate,
} from "@/lib/email/schedule-email";
import type { Day } from "@/lib/domain/types";

export interface ScheduleEmailDialogProps {
  studentEmail: string;
  displayName: string;
  positionName: string;
  /** The working term's name, for `{{term}}`. */
  termName: string;
  template: ScheduleEmailTemplate;
  cc: string;
  from: string;
  marksScheduled: boolean;
  emailEnabled: boolean;
  /** The student's rows in the current run: the schedule table and the first-shift suggestion. */
  shifts: { day: Day; start: number; end: number; cohort: string }[];
}

type Tab = "preview" | "edit";

export function SendScheduleEmailDialog({
  onClose,
  ...p
}: ScheduleEmailDialogProps & { onClose: () => void }) {
  const router = useRouter();
  const termId = useRenderedTermId();
  const firstShiftId = useId();
  const [today] = useState(() => chicagoToday(new Date()));
  // Minted once per opening, so a double click is one send (see the action).
  const [requestId] = useState(() => crypto.randomUUID());
  const [fields, setFields] = useState<ScheduleEmailInput>(() => ({
    startDate: nextSunday(today),
    firstShiftTime: "",
  }));
  const [draft, setDraft] = useState(p.template);
  const [tab, setTab] = useState<Tab>("preview");
  const [includeCc, setIncludeCc] = useState(Boolean(p.cc));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const suggestion = suggestFirstShiftTime(today, p.shifts);
  const set = <K extends keyof ScheduleEmailInput>(k: K, v: ScheduleEmailInput[K]) =>
    setFields((f) => ({ ...f, [k]: v }));
  const edited = draft.subject !== p.template.subject || draft.body !== p.template.body;
  const inputError = validateScheduleEmailInput(fields);
  const templateError = useMemo(() => validateScheduleTemplate(draft), [draft]);

  const preview = useMemo(() => {
    if (!fields.startDate) return null;
    try {
      const vars = buildScheduleEmailVars(
        { displayName: p.displayName, position: p.positionName },
        fields,
        p.termName,
      );
      return { ok: true as const, email: renderScheduleEmail(draft, vars, p.shifts) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [fields, draft, p.displayName, p.positionName, p.termName, p.shifts]);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await sendScheduleEmail(
        p.studentEmail,
        {
          ...fields,
          subject: draft.subject,
          body: draft.body,
          includeCc,
          requestId,
        },
        termId,
      );
      if (!res.ok) {
        setError(res.error ?? "Could not send.");
        return;
      }
      setSent(res.message ?? "Sent.");
      router.refresh();
    });
  }

  if (sent) {
    return (
      <Modal label="Schedule email" onClose={onClose} maxWidth="480px">
        <div className="ad-stack ad-dg-body">
          <Notice tone="success" role="status">
            {sent}
          </Notice>
          <div className="ad-actions">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const shownError = error ?? (fields.startDate ? inputError : null) ?? templateError;

  return (
    <Modal label="Send schedule email" onClose={onClose} maxWidth="680px">
      <div className="ad-stack ad-dg-body">
        {!p.emailEnabled && (
          <Notice tone="danger">
            Email sending is turned off. Turn it on in Email settings to send this.
          </Notice>
        )}

        <div className="ad-fields">
          <Field label="Start date">
            <input
              type="date"
              value={fields.startDate}
              onChange={(e) => set("startDate", e.target.value)}
            />
          </Field>

          <Field label="First shift time (only if it's tomorrow)" htmlFor={firstShiftId}>
            <div className="ad-dg-inputrow">
              <input
                id={firstShiftId}
                aria-label="First shift time"
                placeholder="e.g. 7:00 AM"
                value={fields.firstShiftTime}
                onChange={(e) => set("firstShiftTime", e.target.value)}
              />
              {suggestion && fields.firstShiftTime !== suggestion && (
                <button
                  type="button"
                  onClick={() => set("firstShiftTime", suggestion)}
                  className="ad-linkbtn"
                >
                  Use {suggestion} from the current schedule
                </button>
              )}
            </div>
          </Field>
        </div>

        <div>
          <div role="tablist" aria-label="Email" className="ad-seg">
            <TabButton id="preview" tab={tab} onSelect={setTab}>
              Preview
            </TabButton>
            <TabButton id="edit" tab={tab} onSelect={setTab}>
              {edited ? "Edit (changed)" : "Edit"}
            </TabButton>
          </div>

          {tab === "preview" ? (
            <div role="tabpanel" aria-label="Preview" className="ad-dg-tabpanel">
              <div className="ad-dg-meta">
                <div>From: {p.from}</div>
                <div>To: {p.studentEmail}</div>
                {includeCc && p.cc && <div>Cc: {p.cc}</div>}
                {p.cc && <div>Replies go to: {p.cc}</div>}
              </div>
              {!preview ? (
                <p className="ad-dg-previewnote ad-muted">Pick a start date to see the email.</p>
              ) : preview.ok ? (
                <>
                  <div className="ad-dg-subject">{preview.email.subject}</div>
                  {/* Sanitized by renderScheduleEmail; the schedule table is app-built. */}
                  <div
                    className="ad-dg-emailbody"
                    dangerouslySetInnerHTML={{ __html: preview.email.html }}
                  />
                </>
              ) : (
                <p className="ad-dg-previewnote ad-danger-text">
                  The template has a problem: {preview.error}
                </p>
              )}
            </div>
          ) : (
            <div role="tabpanel" aria-label="Edit" className="ad-dg-tabpanel ad-stack">
              <Field label="Subject">
                <input
                  value={draft.subject}
                  onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                  className="ad-input--block"
                />
              </Field>
              <Field label="Email text">
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  rows={14}
                  className="ad-input--block ad-input--mono"
                />
              </Field>
              <div className="ad-row ad-row--between ad-muted">
                <span>Changes here only apply to this email.</span>
                {edited && (
                  <button type="button" onClick={() => setDraft(p.template)} className="ad-linkbtn">
                    Undo my changes
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {p.cc && (
          <CheckRow label={<>Also send to {p.cc}</>}>
            <input
              type="checkbox"
              checked={includeCc}
              onChange={(e) => setIncludeCc(e.target.checked)}
            />
          </CheckRow>
        )}
        {p.marksScheduled && <p className="ad-muted">Sending also marks them scheduled.</p>}

        {shownError && (
          <ActionMessage ok={false} as="p">
            {shownError}
          </ActionMessage>
        )}

        <div className="ad-actions">
          <Button
            variant="primary"
            onClick={send}
            pending={pending}
            pendingLabel="Sending…"
            disabled={
              !p.emailEnabled || inputError !== null || templateError !== null || !preview?.ok
            }
          >
            Send email
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

function TabButton({
  id,
  tab,
  onSelect,
  children,
}: {
  id: Tab;
  tab: Tab;
  onSelect: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" role="tab" aria-selected={id === tab} onClick={() => onSelect(id)}>
      {children}
    </button>
  );
}
