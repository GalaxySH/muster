"use client";

/**
 * The "Add" link in the Travel / Extracurriculars card headers on the per-student
 * response page: opens a modal with the same fields the student's own form has,
 * and calls the same evidence actions with the student named in a hidden field,
 * so an admin can enter what a student handed them in person.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  addExtracurricularFile,
  addTravelRequest,
  saveExtracurricularNotes,
} from "@/lib/evidence/actions";
import { ACCEPT, FORMAT_HINT } from "@/components/evidence/shared";
import { Modal } from "@/components/Modal";
import { ActionButton } from "@/components/ui";

export function AddEvidenceButton({
  kind,
  studentEmail,
  currentNotes = "",
}: {
  kind: "travel" | "extracurricular";
  studentEmail: string;
  /** The student's existing extracurricular details, so the box edits rather than replaces them. */
  currentNotes?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const title = kind === "travel" ? "Add travel entry" : "Add extracurricular";

  // Reopening starts clean: a failed attempt's error must not greet the next one.
  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const added =
        kind === "travel"
          ? await addTravelRequest(formData)
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
        Add
      </button>

      {open && (
        <Modal label={title} onClose={close}>
          <form onSubmit={submit} style={formStyle}>
            <input type="hidden" name="student" value={studentEmail} />

            <div style={fieldArea}>
              {kind === "travel" ? (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <label style={field}>
                      Start
                      <input type="date" name="startDate" required />
                    </label>
                    <label style={field}>
                      End
                      <input type="date" name="endDate" required />
                    </label>
                  </div>
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
                Proof
                <input type="file" name="file" accept={ACCEPT} required />
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
              <ActionButton type="submit" pending={pending} pendingLabel="Uploading…">
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
 * pending button label never move the controls under the pointer. Both kinds of
 * entry use the same footprint, so the two modals open identically.
 */
const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "min(380px, 80vw)",
  height: 300,
  fontSize: 14,
};
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
