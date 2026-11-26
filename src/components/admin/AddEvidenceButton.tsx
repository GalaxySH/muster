"use client";

/**
 * The header link in the Course schedule / Travel / Extracurriculars cards on the
 * per-student response page: opens a modal with the same fields the student's
 * own form has, and calls the same evidence actions with the student named in a
 * hidden field, so an admin can enter what a student handed them in person.
 *
 * Only the course schedule needs a file. Travel can go in without proof, and the
 * extracurricular box edits the details with proof as an optional extra.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import {
  addExtracurricularFile,
  addTravelRequest,
  saveExtracurricularNotes,
  uploadCourseSchedule,
} from "@/lib/evidence/actions";
import { ACCEPT, FORMAT_HINT } from "@/components/evidence/shared";
import { TravelDateRange } from "@/components/evidence/TravelDateRange";
import { Modal } from "@/components/Modal";
import { submitOnCtrlEnter } from "@/components/form-keys";
import { ActionMessage, Button, Field } from "@/components/admin/ui";

export type EvidenceKind = "course" | "travel" | "extracurricular";

const TITLES: Record<EvidenceKind, string> = {
  course: "Add course schedule",
  travel: "Add travel entry",
  extracurricular: "Edit extracurriculars",
};

export function AddEvidenceButton({
  kind,
  studentEmail,
  currentNotes = "",
  replaces = false,
}: {
  kind: EvidenceKind;
  studentEmail: string;
  /** The student's existing extracurricular details, so the box edits rather than replaces them. */
  currentNotes?: string;
  /** A course schedule is one file: naming the swap warns that uploading drops the old one. */
  replaces?: boolean;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Proof is optional outside the course schedule, so the button says what it is actually doing.
  const [hasFile, setHasFile] = useState(false);
  const [pending, startTransition] = useTransition();

  const title = replaces ? "Replace course schedule" : TITLES[kind];
  const submitLabel = kind === "extracurricular" ? (hasFile ? "Upload and save" : "Save") : title;

  // Reopening starts clean: a failed attempt's error must not greet the next one.
  function close() {
    setOpen(false);
    setError(null);
    setHasFile(false);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      // An extracurricular edit may be details only, with nothing to upload.
      if (kind !== "extracurricular" || hasFile) {
        const added =
          kind === "travel"
            ? await addTravelRequest(formData)
            : kind === "course"
              ? await uploadCourseSchedule(formData)
              : await addExtracurricularFile(formData);
        if (!added.ok) {
          setError(added.error ?? "Something went wrong.");
          return;
        }
      }
      // Details are one field on the submission, not per file, so save them only
      // when the admin actually changed them.
      const notes = String(formData.get("notes") ?? "");
      if (kind === "extracurricular" && notes !== currentNotes) {
        const saved = await saveExtracurricularNotes(notes, studentEmail, termId);
        if (!saved.ok) {
          setError(saved.error ?? "The details did not save.");
          // A proof uploaded just before still landed, so show it.
          router.refresh();
          return;
        }
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ad-linkbtn" aria-label={title}>
        {replaces ? "Replace" : kind === "extracurricular" ? "Edit" : "Add"}
      </button>

      {open && (
        <Modal label={title} onClose={close} maxWidth="420px">
          <form onSubmit={submit} className="ad-stack ad-dg-body">
            <input type="hidden" name="student" value={studentEmail} />
            <input type="hidden" name="termId" value={termId} />

            {kind === "course" ? (
              replaces && <p className="ad-muted">This replaces the schedule already on file.</p>
            ) : kind === "travel" ? (
              <>
                <TravelDateRange />
                <Field label="Note (optional)">
                  <input type="text" name="note" className="ad-input--block" />
                </Field>
              </>
            ) : (
              <Field label="Details">
                <textarea
                  name="notes"
                  defaultValue={currentNotes}
                  placeholder="The activity, including dates and times"
                  rows={5}
                  onKeyDown={submitOnCtrlEnter}
                  className="ad-input--block"
                />
              </Field>
            )}

            {/* Students must attach travel proof. An admin entering an
                excusal for someone is the excusal, so theirs may go in
                without one, and extracurricular details stand on their own. */}
            <Field label={kind === "course" ? "Proof" : "Proof (optional)"} help={FORMAT_HINT}>
              <input
                type="file"
                name="file"
                accept={ACCEPT}
                required={kind === "course"}
                onChange={(e) => setHasFile(Boolean(e.currentTarget.files?.length))}
              />
            </Field>

            {error && (
              <ActionMessage ok={false} as="p">
                {error}
              </ActionMessage>
            )}

            <div className="ad-actions">
              <Button
                type="submit"
                variant="primary"
                pending={pending}
                pendingLabel={hasFile ? "Uploading…" : "Saving…"}
              >
                {submitLabel}
              </Button>
              <Button disabled={pending} onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
