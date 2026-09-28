"use client";

/**
 * The confirmation dialog for the "your schedule is posted" email, opened from
 * the Mark scheduled menu on the per-student page. The scheduler fills in the
 * start date (default: next Sunday) and the optional cross-over and first-shift
 * values, checks the live preview, and sends. Nothing is sent without the Send
 * click here.
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
  type ScheduleEmailInput,
} from "@/lib/email/schedule-email";
import type { Day } from "@/lib/domain/types";

export interface ScheduleEmailDialogProps {
  studentEmail: string;
  displayName: string;
  positionName: string;
  /** Other positions, for the cross-over picker. */
  positions: string[];
  template: { subject: string; body: string };
  cc: string;
  from: string;
  marksScheduled: boolean;
  emailEnabled: boolean;
  /** The student's rows in the current run, for the first-shift suggestion. */
  shiftCells: { day: Day; start: number; cohort: string }[];
}

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
    crossoverPosition: "",
    crossoverShift: "",
    firstShiftTime: "",
  }));
  const [includeCc, setIncludeCc] = useState(Boolean(p.cc));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const suggestion = suggestFirstShiftTime(today, p.shiftCells);
  const set = (k: keyof ScheduleEmailInput, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const inputError = validateScheduleEmailInput(fields);

  const preview = useMemo(() => {
    if (!fields.startDate) return null;
    try {
      const vars = buildScheduleEmailVars(
        { displayName: p.displayName, position: p.positionName },
        fields,
      );
      return { ok: true as const, email: renderScheduleEmail(p.template, vars) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [fields, p.displayName, p.positionName, p.template]);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await sendScheduleEmail(p.studentEmail, { ...fields, includeCc, requestId });
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

  return (
    <Modal label="Send schedule email" onClose={onClose} maxWidth="640px">
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
        {!p.emailEnabled && (
          <p style={{ margin: 0, color: "var(--color-text-danger)" }}>
            Email sending is turned off. Turn it on in Email settings to send this.
          </p>
        )}

        <label style={fieldStyle}>
          <span style={labelStyle}>Start date</span>
          <input
            type="date"
            value={fields.startDate}
            onChange={(e) => set("startDate", e.target.value)}
            style={{ ...inputStyle, maxWidth: 200 }}
          />
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>Cross-over shift (optional)</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select
              aria-label="Cross-over position"
              value={fields.crossoverPosition}
              onChange={(e) => set("crossoverPosition", e.target.value)}
              style={{ ...inputStyle, width: "auto", flex: "1 1 160px" }}
            >
              <option value="">None</option>
              {p.positions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input
              aria-label="Cross-over shift"
              placeholder="e.g. Tuesday 2 to 5 PM"
              value={fields.crossoverShift}
              onChange={(e) => set("crossoverShift", e.target.value)}
              style={{ ...inputStyle, width: "auto", flex: "2 1 200px" }}
            />
          </div>
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>First shift time (only if it&apos;s tomorrow)</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input
              aria-label="First shift time"
              placeholder="e.g. 7:00 AM"
              value={fields.firstShiftTime}
              onChange={(e) => set("firstShiftTime", e.target.value)}
              style={{ ...inputStyle, maxWidth: 200 }}
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

        <div style={previewStyle}>
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
              <div style={{ whiteSpace: "pre-wrap" }}>{preview.email.text}</div>
            </>
          ) : (
            <div style={{ color: "var(--color-text-danger)" }}>
              The template has a problem: {preview.error}
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

        {(error || (inputError && fields.startDate)) && (
          <p role="alert" style={{ margin: 0, color: "var(--color-text-danger)" }}>
            {error ?? inputError}
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
            disabled={!p.emailEnabled || inputError !== null || !preview?.ok}
          >
            Send email
          </ActionButton>
        </div>
      </div>
    </Modal>
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
const previewStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
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
