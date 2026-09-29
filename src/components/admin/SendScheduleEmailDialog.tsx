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
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { ActionButton } from "@/components/ui";
import { sendScheduleEmail } from "@/lib/admin/schedule-email-actions";
import {
  buildScheduleEmailVars,
  chicagoToday,
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
      );
      return { ok: true as const, email: renderScheduleEmail(draft, vars, p.shifts) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [fields, draft, p.displayName, p.positionName, p.shifts]);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await sendScheduleEmail(p.studentEmail, {
        ...fields,
        subject: draft.subject,
        body: draft.body,
        includeCc,
        requestId,
      });
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
        <p style={{ margin: "0 0 12px", color: "var(--color-text-success)" }}>✓ {sent}</p>
        <ActionButton onClick={onClose}>Done</ActionButton>
      </Modal>
    );
  }

  const shownError = error ?? (fields.startDate ? inputError : null) ?? templateError;

  return (
    <Modal label="Send schedule email" onClose={onClose} maxWidth="680px">
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
        {!p.emailEnabled && (
          <p style={{ margin: 0, color: "var(--color-text-danger)" }}>
            Email sending is turned off. Turn it on in Email settings to send this.
          </p>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Start date</span>
            <input
              type="date"
              value={fields.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              style={{ ...inputStyle, width: 180 }}
            />
          </label>

          <div style={fieldStyle}>
            <span style={labelStyle}>First shift time (only if it&apos;s tomorrow)</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <input
                aria-label="First shift time"
                placeholder="e.g. 7:00 AM"
                value={fields.firstShiftTime}
                onChange={(e) => set("firstShiftTime", e.target.value)}
                style={{ ...inputStyle, width: 180 }}
              />
              {suggestion && fields.firstShiftTime !== suggestion && (
                <button
                  type="button"
                  onClick={() => set("firstShiftTime", suggestion)}
                  style={linkButton}
                >
                  Use {suggestion} from the current schedule
                </button>
              )}
            </div>
          </div>
        </div>

        <div>
          <div role="tablist" aria-label="Email" style={{ display: "flex", gap: 4 }}>
            <TabButton id="preview" tab={tab} onSelect={setTab}>
              Preview
            </TabButton>
            <TabButton id="edit" tab={tab} onSelect={setTab}>
              {edited ? "Edit (changed)" : "Edit"}
            </TabButton>
          </div>

          {tab === "preview" ? (
            <div role="tabpanel" aria-label="Preview" style={panelStyle}>
              <div style={metaStyle}>
                <div>From: {p.from}</div>
                <div>To: {p.studentEmail}</div>
                {includeCc && p.cc && <div>Cc: {p.cc}</div>}
                {p.cc && <div>Replies go to: {p.cc}</div>}
              </div>
              {!preview ? (
                <div style={{ color: "var(--color-text-secondary)" }}>
                  Pick a start date to see the email.
                </div>
              ) : preview.ok ? (
                <>
                  <div style={{ fontWeight: 600, margin: "8px 0" }}>{preview.email.subject}</div>
                  {/* Sanitized by renderScheduleEmail; the schedule table is app-built. */}
                  <div dangerouslySetInnerHTML={{ __html: preview.email.html }} />
                </>
              ) : (
                <div style={{ color: "var(--color-text-danger)" }}>
                  The template has a problem: {preview.error}
                </div>
              )}
            </div>
          ) : (
            <div
              role="tabpanel"
              aria-label="Edit"
              style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 8 }}
            >
              <label style={fieldStyle}>
                <span style={labelStyle}>Subject</span>
                <input
                  value={draft.subject}
                  onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>Email text</span>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  rows={14}
                  style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                }}
              >
                <span>Changes here only apply to this email.</span>
                {edited && (
                  <button type="button" onClick={() => setDraft(p.template)} style={linkButton}>
                    Undo my changes
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {p.cc && (
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includeCc}
              onChange={(e) => setIncludeCc(e.target.checked)}
            />
            Also send to {p.cc}
          </label>
        )}
        {p.marksScheduled && (
          <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
            Sending also marks them scheduled.
          </p>
        )}

        {shownError && (
          <p role="alert" style={{ margin: 0, color: "var(--color-text-danger)" }}>
            {shownError}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <ActionButton variant="secondary" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton
            onClick={send}
            pending={pending}
            pendingLabel="Sending…"
            disabled={
              !p.emailEnabled || inputError !== null || templateError !== null || !preview?.ok
            }
          >
            Send email
          </ActionButton>
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
  const active = id === tab;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(id)}
      style={{
        padding: "6px 14px",
        border: "1px solid var(--color-border-secondary)",
        borderBottomColor: active
          ? "var(--color-background-secondary)"
          : "var(--color-border-secondary)",
        borderRadius: "var(--border-radius-md) var(--border-radius-md) 0 0",
        background: active ? "var(--color-background-secondary)" : "transparent",
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontWeight: active ? 600 : 400,
        fontSize: 13,
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const panelStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "0 var(--border-radius-md) var(--border-radius-md) var(--border-radius-md)",
  background: "var(--color-background-secondary)",
};
const metaStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-text-secondary)",
  paddingBottom: 8,
  borderBottom: "1px solid var(--color-border-tertiary)",
};
const linkButton: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--color-text-info, #1a66cc)",
  textDecoration: "underline",
  cursor: "pointer",
  fontSize: 13,
};
