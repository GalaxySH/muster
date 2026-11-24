"use client";

/**
 * Header control on the per-student page for the Google Form paste import
 * (docs/form-paste.md). The scheduler copies a response in the sheet with
 * "Copy for Muster", pastes it here, checks the preview against what's on file,
 * and applies the checked changes through the same per-student actions the rest
 * of the page uses. Nothing is written until Apply.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { ActionButton } from "@/components/ui";
import { dangerPillStyle, successPillStyle, warningPillStyle } from "@/components/admin/ui";
import { buildPlan, parsePaste, type OnFile, type Plan, type Step } from "@/lib/admin/form-paste";
import { applyPlan, type PasteActions, type StepResult } from "@/lib/admin/form-paste-apply";
import { saveSchedulerNotes } from "@/lib/admin/actions";
import { recordFormResponse, saveEveryWeekendFor } from "@/lib/admin/form-paste-actions";
import { saveDesiredHoursFor, saveStudentNotesFor } from "@/lib/availability/actions";
import {
  addExtracurricularFile,
  addTravelRequest,
  saveExtracurricularNotes,
  uploadCourseSchedule,
} from "@/lib/evidence/actions";

const ACTIONS: PasteActions = {
  saveDesiredHours: saveDesiredHoursFor,
  saveEveryWeekend: saveEveryWeekendFor,
  saveStudentNotes: saveStudentNotesFor,
  saveExtracurricularNotes,
  uploadCourseSchedule,
  addExtracurricularFile,
  addTravelRequest,
  saveSchedulerNotes,
  recordFormResponse,
};

type Read = { plan: Plan } | { error: string } | null;

export function FormPasteButton({
  studentEmail,
  onFile,
  termStartsOn,
}: {
  studentEmail: string;
  onFile: OnFile;
  /** The working term's start date, which gives the pasted travel dates their year. */
  termStartsOn: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // Per-step overrides: the checkbox, and travel dates edited in the preview.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  const read: Read = useMemo(() => {
    if (!text.trim()) return null;
    const parsed = parsePaste(text);
    if (!parsed.ok) return { error: parsed.error };
    if (parsed.paste.email !== studentEmail.toLowerCase()) {
      return { error: `This response is from ${parsed.paste.email}, not this student.` };
    }
    return { plan: buildPlan(parsed.paste, onFile, termStartsOn) };
  }, [text, studentEmail, onFile, termStartsOn]);

  const plan = read && "plan" in read ? read.plan : null;
  const isOn = (s: Step) => checked[s.id] ?? s.on;
  const withEdits = (s: Step): Step =>
    s.kind === "travel" && dates[s.id] ? { ...s, ...dates[s.id] } : s;
  const chosen = plan ? plan.steps.filter(isOn).map(withEdits) : [];
  const badDates = chosen.some(
    (s) => s.kind === "travel" && (!s.start || !s.end || s.end < s.start),
  );

  function close() {
    setOpen(false);
    setText("");
    setChecked({});
    setDates({});
    // Anything that landed should show on the page behind.
    if (results) router.refresh();
    setResults(null);
  }

  function apply() {
    if (!plan) return;
    startTransition(async () => {
      setResults(
        await applyPlan({ student: studentEmail, plan, chosen, onFile, actions: ACTIONS }),
      );
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={triggerStyle}>
        Paste form response
      </button>

      {open && (
        <Modal label="Paste a Google Form response" onClose={close} maxWidth="720px">
          {results ? (
            <ResultList results={results} onDone={close} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
              {!plan && (
                <>
                  <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
                    In the response sheet, pick the row and use Muster &gt; Copy response for
                    Muster. Then paste it here.
                  </p>
                  <textarea
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="MUSTER-FORM v1"
                    style={pasteBox}
                  />
                  {read && "error" in read && (
                    <p role="alert" style={{ margin: 0, color: "var(--color-text-danger)" }}>
                      {read.error}
                    </p>
                  )}
                </>
              )}

              {plan && (
                <>
                  <div style={{ fontWeight: 600 }}>{plan.name}</div>
                  {plan.warnings.map((w) => (
                    <div key={w} style={warningBox}>
                      {w}
                    </div>
                  ))}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {plan.steps.map((s) => (
                      <StepRow
                        key={s.id}
                        step={withEdits(s)}
                        on={isOn(s)}
                        onToggle={(on) => setChecked((c) => ({ ...c, [s.id]: on }))}
                        onDates={(d) => setDates((all) => ({ ...all, [s.id]: d }))}
                      />
                    ))}
                  </div>
                </>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                {badDates && (
                  <span style={{ fontSize: 13, color: "var(--color-text-danger)" }}>
                    Fix the travel dates first.
                  </span>
                )}
                {plan && (
                  <ActionButton variant="secondary" disabled={pending} onClick={() => setText("")}>
                    Paste another
                  </ActionButton>
                )}
                <ActionButton variant="secondary" disabled={pending} onClick={close}>
                  Cancel
                </ActionButton>
                <ActionButton
                  pending={pending}
                  pendingLabel="Applying…"
                  disabled={!plan || chosen.length === 0 || badDates}
                  onClick={apply}
                >
                  {chosen.length === 1 ? "Apply 1 change" : `Apply ${chosen.length} changes`}
                </ActionButton>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function StepRow({
  step,
  on,
  onToggle,
  onDates,
}: {
  step: Step;
  on: boolean;
  onToggle: (on: boolean) => void;
  onDates: (d: { start: string; end: string }) => void;
}) {
  return (
    <div style={{ ...rowStyle, opacity: on ? 1 : 0.65 }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={step.label}
        style={{ marginTop: 3 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{step.label}</div>
        {step.kind === "travel" ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="date"
              value={step.start}
              aria-label={`${step.label} start`}
              onChange={(e) => onDates({ start: e.target.value, end: step.end })}
            />
            to
            <input
              type="date"
              value={step.end}
              aria-label={`${step.label} end`}
              onChange={(e) => onDates({ start: step.start, end: e.target.value })}
            />
          </div>
        ) : (
          <div style={valueStyle}>{step.value}</div>
        )}
        {step.kind === "travel" && step.travelNote && (
          <div style={subtle}>Note: {step.travelNote}</div>
        )}
        {step.current && step.kind !== "notes" && <div style={subtle}>On file: {step.current}</div>}
        {step.note && <div style={subtle}>{step.note}</div>}
      </div>
    </div>
  );
}

function ResultList({ results, onDone }: { results: StepResult[]; onDone: () => void }) {
  const failed = results.filter((r) => !r.ok).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
      <p style={{ margin: 0 }}>
        {failed === 0
          ? "All changes applied."
          : `${failed} of ${results.length} didn't apply. The rest did.`}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {results.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={r.ok ? successPillStyle : dangerPillStyle}>
              {r.ok ? "done" : "failed"}
            </span>
            <span>{r.label}</span>
            {r.error && <span style={{ color: "var(--color-text-danger)" }}>{r.error}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ActionButton onClick={onDone}>Done</ActionButton>
      </div>
    </div>
  );
}

/** Matches the other quiet header controls (e.g. "New change request"). */
const triggerStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "5px 12px",
  borderRadius: "var(--border-radius-md)",
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const pasteBox: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 120,
  padding: 8,
  fontFamily: "monospace",
  fontSize: 12,
  resize: "vertical",
};

const warningBox: React.CSSProperties = {
  ...warningPillStyle,
  display: "block",
  whiteSpace: "normal",
  borderRadius: "var(--border-radius-md)",
  padding: "6px 10px",
  fontSize: 13,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "8px 10px",
  border: "1px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-md)",
};

const valueStyle: React.CSSProperties = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
const subtle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-tertiary)",
  overflowWrap: "anywhere",
};
