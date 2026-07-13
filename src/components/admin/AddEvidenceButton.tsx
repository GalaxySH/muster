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
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={addLink} aria-label={title}>
        Add
      </button>

      {open && (
        <Modal label={title} onClose={() => setOpen(false)} width="min(420px, 92vw)">
          <form onSubmit={submit} style={{ display: "grid", gap: 10, fontSize: 14 }}>
            <input type="hidden" name="student" value={studentEmail} />

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
              <label style={field}>
                Details
                <textarea
                  name="notes"
                  defaultValue={currentNotes}
                  rows={3}
                  placeholder="The activity, including dates and times"
                  style={{ padding: 8, width: "100%", boxSizing: "border-box" }}
                />
              </label>
            )}

            <label style={field}>
              Proof
              <input type="file" name="file" accept={ACCEPT} required />
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{FORMAT_HINT}</span>
            </label>

            {error && (
              <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--color-text-danger)" }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <ActionButton variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
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

const field: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
