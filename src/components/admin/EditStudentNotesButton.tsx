"use client";

/**
 * The quiet "Edit" on the Student notes card: opens the student's own note
 * from the availability form in a box and saves it back on their row
 * (`saveStudentNotesFor`), for when somebody hands the scheduler a change in
 * person. Same modal and buttons as the travel entry edit.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveStudentNotesFor } from "@/lib/availability/actions";
import { Modal } from "@/components/Modal";
import { ActionButton } from "@/components/ui";

export function EditStudentNotesButton({
  studentEmail,
  notes,
}: {
  studentEmail: string;
  notes: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reopening starts clean: a failed attempt's error must not greet the next one.
  function close() {
    setOpen(false);
    setError(null);
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("notes") ?? "");
    setError(null);
    startTransition(async () => {
      const res = await saveStudentNotesFor(studentEmail, text);
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
      <button type="button" onClick={() => setOpen(true)} style={link}>
        Edit
      </button>

      {open && (
        <Modal label="Edit student notes" onClose={close} maxWidth="480px">
          <form onSubmit={save} style={formStyle}>
            <textarea
              name="notes"
              defaultValue={notes}
              rows={6}
              autoFocus
              aria-label="Student notes"
              style={textarea}
            />
            <p role="status" style={errorSlot}>
              {error}
            </p>
            <div style={buttonRow}>
              <ActionButton variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </ActionButton>
              <ActionButton type="submit" pending={pending} pendingLabel="Saving…">
                Save
              </ActionButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Matches the other cards' "Add" in the header slot. */
const link: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  fontWeight: 500,
  color: "var(--color-text-info)",
  cursor: "pointer",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "100%",
  fontSize: 14,
};
const textarea: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: 8,
  resize: "vertical",
  borderRadius: "var(--border-radius-md)",
  border: "1px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
};
const errorSlot: React.CSSProperties = {
  margin: 0,
  minHeight: 20,
  fontSize: 13,
  color: "var(--color-text-danger)",
};
const buttonRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
};
