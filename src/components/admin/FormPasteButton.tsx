"use client";

/**
 * Header control on the per-student page for the Google Form paste import
 * (docs/form-paste.md). The scheduler copies a response in the sheet with
 * "Copy for Muster", pastes it here, checks the preview against what's on file,
 * and applies the checked changes through the same per-student actions the rest
 * of the page uses. Nothing is written until Apply.
 */
import { useMemo, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { ActionMessage, Button, CheckRow, Field, Notice, Pill } from "@/components/admin/ui";
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

/** Every step goes to the semester this page is showing. */
function pasteActions(termId: string): PasteActions {
  const withTerm = (form: FormData) => {
    form.set("termId", termId);
    return form;
  };
  return {
    saveDesiredHours: (student, hours) => saveDesiredHoursFor(student, hours, termId),
    saveEveryWeekend: (student, optIn) => saveEveryWeekendFor(student, optIn, termId),
    saveStudentNotes: (student, text) => saveStudentNotesFor(student, text, termId),
    saveExtracurricularNotes: (text, student) => saveExtracurricularNotes(text, student, termId),
    uploadCourseSchedule: (form) => uploadCourseSchedule(withTerm(form)),
    addExtracurricularFile: (form) => addExtracurricularFile(withTerm(form)),
    addTravelRequest: (form) => addTravelRequest(withTerm(form)),
    saveSchedulerNotes: (student, notes) => saveSchedulerNotes(student, notes, termId),
    recordFormResponse: (student, at) => recordFormResponse(student, at, termId),
  };
}

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
  const termId = useRenderedTermId();
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
        await applyPlan({
          student: studentEmail,
          plan,
          chosen,
          onFile,
          actions: pasteActions(termId),
        }),
      );
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Paste form response</Button>

      {open && (
        <Modal label="Paste a Google Form response" onClose={close} maxWidth="720px">
          {results ? (
            <ResultList results={results} onDone={close} />
          ) : (
            <div className="ad-stack ad-dg-body">
              {!plan && (
                <>
                  <p className="ad-muted">
                    In the response sheet, pick the row and use Muster &gt; Copy response for
                    Muster. Then paste it here.
                  </p>
                  <Field label="Response">
                    <textarea
                      autoFocus
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="MUSTER-FORM v1"
                      className="ad-input--block ad-input--mono ad-dg-paste"
                    />
                  </Field>
                  {read && "error" in read && (
                    <ActionMessage ok={false} as="p">
                      {read.error}
                    </ActionMessage>
                  )}
                </>
              )}

              {plan && (
                <>
                  <div className="ad-strong">{plan.name}</div>
                  {plan.warnings.map((w) => (
                    <Notice key={w} tone="warning">
                      {w}
                    </Notice>
                  ))}
                  <div className="ad-stack ad-stack--tight">
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

              {badDates && <p className="ad-error">Fix the travel dates first.</p>}

              <div className="ad-actions">
                <Button
                  variant="primary"
                  pending={pending}
                  pendingLabel="Applying…"
                  disabled={!plan || chosen.length === 0 || badDates}
                  onClick={apply}
                >
                  {chosen.length === 1 ? "Apply 1 change" : `Apply ${chosen.length} changes`}
                </Button>
                {plan && (
                  <Button disabled={pending} onClick={() => setText("")}>
                    Paste another
                  </Button>
                )}
                <Button disabled={pending} onClick={close}>
                  Cancel
                </Button>
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
    <div className={on ? "ad-dg-step" : "ad-dg-step ad-dg-step--off"}>
      <CheckRow label={step.label}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
      </CheckRow>
      <div className="ad-dg-step-body">
        {step.kind === "travel" ? (
          <div className="ad-dg-step-dates">
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
          <div className="ad-prewrap">{step.value}</div>
        )}
        {step.kind === "travel" && step.travelNote && (
          <div className="ad-dg-step-note">Note: {step.travelNote}</div>
        )}
        {step.current && step.kind !== "notes" && (
          <div className="ad-dg-step-note">On file: {step.current}</div>
        )}
        {step.note && <div className="ad-dg-step-note">{step.note}</div>}
      </div>
    </div>
  );
}

function ResultList({ results, onDone }: { results: StepResult[]; onDone: () => void }) {
  const failed = results.filter((r) => !r.ok).length;
  return (
    <div className="ad-stack ad-dg-body">
      <Notice tone={failed === 0 ? "success" : "warning"} role="status">
        {failed === 0
          ? "All changes applied."
          : `${failed} of ${results.length} didn't apply. The rest did.`}
      </Notice>
      <div className="ad-stack ad-stack--tight">
        {results.map((r) => (
          <div key={r.id} className="ad-dg-result">
            <Pill tone={r.ok ? "success" : "danger"}>{r.ok ? "done" : "failed"}</Pill>
            <span>{r.label}</span>
            {r.error && <span className="ad-danger-text">{r.error}</span>}
          </div>
        ))}
      </div>
      <div className="ad-actions">
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
