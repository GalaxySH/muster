"use client";

/**
 * Remove for one evidence file on the per-student response page: the course
 * schedule (beside Replace in the card header) or a single extracurricular proof
 * (under its thumbnail). Calls the evidence actions with the student named, the
 * same way the Add modal does.
 *
 * Removing deletes the Drive file too, so it asks first.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCourseSchedule, removeExtracurricularFile } from "@/lib/evidence/actions";
import { Modal } from "@/components/Modal";
import { ActionButton } from "@/components/ui";

type RemoveTarget = { kind: "course" } | { kind: "extracurricular"; rowId: string };

const COPY = {
  course: { title: "Remove course schedule", prompt: "Remove the course schedule on file?" },
  extracurricular: { title: "Remove proof", prompt: "Remove this proof?" },
} as const;

export function RemoveEvidenceButton(props: RemoveTarget & { studentEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const copy = COPY[props.kind];

  // Reopening starts clean: a failed attempt's error must not greet the next one.
  function close() {
    setOpen(false);
    setError(null);
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res =
        props.kind === "course"
          ? await removeCourseSchedule(props.studentEmail)
          : await removeExtracurricularFile(props.rowId, props.studentEmail);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.title}
        style={props.kind === "course" ? headerLink : thumbLink}
      >
        Remove
      </button>

      {open && (
        <Modal label={copy.title} onClose={close} maxWidth="420px">
          <div style={boxStyle}>
            <p style={{ margin: 0, fontSize: 14 }}>{copy.prompt} This deletes the file too.</p>
            <p role="status" style={errorSlot}>
              {error}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <ActionButton variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </ActionButton>
              {/* Destructive, so the outlined danger button the travel entry and
                  response delete use rather than the primary one. */}
              <button
                type="button"
                className="btn-hover"
                onClick={remove}
                disabled={pending}
                style={dangerButton(pending)}
              >
                {pending ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** A quiet danger link matching the Replace link it sits beside. */
const headerLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  fontWeight: 500,
  color: "var(--color-text-danger)",
  cursor: "pointer",
};
/** Smaller, to sit under a proof thumbnail beside its caption. */
const thumbLink: React.CSSProperties = { ...headerLink, fontSize: 11 };

const boxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "100%",
  fontSize: 14,
};
/** Reserved room, so an error never moves the buttons. */
const errorSlot: React.CSSProperties = {
  margin: 0,
  minHeight: 32,
  fontSize: 13,
  color: "var(--color-text-danger)",
};
const dangerButton = (pending: boolean): React.CSSProperties => ({
  fontSize: 13,
  padding: "5px 12px",
  borderRadius: "var(--border-radius-md)",
  cursor: pending ? "default" : "pointer",
  border: "1px solid var(--color-border-danger, #d93025)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-danger)",
  opacity: pending ? 0.5 : 1,
});
