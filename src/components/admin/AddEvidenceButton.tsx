"use client";

/**
 * The "Add" link in the Course schedule / Travel / Extracurriculars card headers
 * on the per-student response page: opens a modal with the same fields the
 * student's own form has, and calls the same evidence actions with the student
 * named in a hidden field, so an admin can enter what a student handed them in
 * person.
 */
import { useState, useTransition, type FormEvent } from "react";
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
import { ActionButton } from "@/components/ui";

export type EvidenceKind = "course" | "travel" | "extracurricular";

const TITLES: Record<EvidenceKind, string> = {
  course: "Add course schedule",
  travel: "Add travel entry",
  extracurricular: "Add extracurricular",
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Travel can go in without proof, so the button says what it is actually doing.
  const [hasFile, setHasFile] = useState(false);
  const [pending, startTransition] = useTransition();

  const title = replaces ? "Replace course schedule" : TITLES[kind];

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
      // Details are one field on the submission, not per file, so save them only
      // when the admin actually changed them.
      const notes = String(formData.get("notes") ?? "");
      if (kind === "extracurricular" && notes !== currentNotes) {
        const saved = await saveExtracurricularNotes(notes, studentEmail);
        if (!saved.ok) {
          setError(saved.error ?? "The proof was added but the details did not save.");
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
      <button type="button" onClick={() => setOpen(true)} style={addLink} aria-label={title}>
        {replaces ? "Replace" : "Add"}
      </button>

      {open && (
        <Modal label={title} onClose={close} maxWidth="420px">
          <form onSubmit={submit} style={formStyle(kind)}>
            <input type="hidden" name="student" value={studentEmail} />

            <div style={fieldArea}>
              {kind === "course" ? (
                replaces && (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
                    This replaces the schedule already on file.
                  </p>
                )
              ) : kind === "travel" ? (
                <>
                  <TravelDateRange />
                  <label style={field}>
                    Note (optional)
                    <input type="text" name="note" style={{ padding: 6 }} />
                  </label>
                </>
              ) : (
                // The details box takes the room travel spends on its date fields.
                <label style={{ ...field, flex: 1, minHeight: 0, gridTemplateRows: "auto 1fr" }}>
                  Details
                  <textarea
                    name="notes"
                    defaultValue={currentNotes}
                    placeholder="The activity, including dates and times"
                    style={{ padding: 8, width: "100%", boxSizing: "border-box", resize: "none" }}
                  />
                </label>
              )}

              <label style={field}>
                {kind === "travel" ? "Proof (optional)" : "Proof"}
                {/* Students must attach proof. An admin entering an excusal for
                    someone is the excusal, so theirs may go in without one. */}
                <input
                  type="file"
                  name="file"
                  accept={ACCEPT}
                  required={kind !== "travel"}
                  onChange={(e) => setHasFile(Boolean(e.currentTarget.files?.length))}
                />
                <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{FORMAT_HINT}</span>
              </label>
            </div>

            {/* Always rendered, so an error appears in space the box already holds. */}
            <p role="status" style={errorSlot}>
              {error}
            </p>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <ActionButton variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                pending={pending}
                pendingLabel={hasFile ? "Uploading…" : "Saving…"}
              >
                {title}
              </ActionButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** A quiet text link sitting in the card header, next to the section title. */
const addLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  fontWeight: 500,
  color: "var(--color-text-info)",
  cursor: "pointer",
};

/**
 * The box holds one size for its whole life: an error, a long file name, or a
 * pending button label never move the controls under the pointer. Travel and
 * extracurricular share a footprint, so those two modals open identically; the
 * course schedule is only a file picker, so it gets its own smaller one rather
 * than opening mostly empty. Width comes from the panel (full width on a phone,
 * capped on a desktop), height is ours.
 */
const formStyle = (kind: EvidenceKind): React.CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "100%",
  height: kind === "course" ? 210 : 300,
  fontSize: 14,
});
/** The fields take whatever the reserved rows below them leave, and scroll if they need more. */
const fieldArea: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
/** Reserved room for the longest error we raise (the Drive-not-connected one). */
const errorSlot: React.CSSProperties = {
  margin: 0,
  height: 46,
  overflowY: "auto",
  fontSize: 13,
  color: "var(--color-text-danger)",
};

const field: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
