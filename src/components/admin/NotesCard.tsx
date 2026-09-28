"use client";

/**
 * A free-text notes card on the per-student page: the full text as readable
 * paragraphs, edited in a modal opened by the header's "Edit" or by
 * double-clicking the text. One mechanism for both notes the page carries:
 *
 * - **scheduling**: the scheduler's own notes (PLAN §10a), `saveSchedulerNotes`.
 * - **student**: the student's note from the availability form, saved back on
 *   their row (`saveStudentNotesFor`) for when somebody hands the scheduler a
 *   change in person.
 *
 * Both actions create the submission row on demand, so either note can go on
 * anyone on the roster.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveSchedulerNotes } from "@/lib/admin/actions";
import { saveStudentNotesFor } from "@/lib/availability/actions";
import { Modal } from "@/components/Modal";
import { ActionButton } from "@/components/ui";
import { SectionLabel, panelStyle } from "@/components/admin/ui";

export type NotesKind = "scheduling" | "student";

const KINDS: Record<
  NotesKind,
  {
    title: string;
    placeholder: string;
    save: (email: string, notes: string) => Promise<{ ok: boolean; error?: string }>;
  }
> = {
  scheduling: {
    title: "Scheduling notes",
    placeholder: "e.g. A weekend + Tue close; gave 5p to 8:30p Mon/Wed",
    save: saveSchedulerNotes,
  },
  student: { title: "Student notes", placeholder: "", save: saveStudentNotesFor },
};

export function NotesCard({
  kind,
  studentEmail,
  notes,
}: {
  kind: NotesKind;
  studentEmail: string;
  notes: string;
}) {
  const { title, placeholder, save } = KINDS[kind];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function edit() {
    // A double-click also selects the word under the pointer; drop it so the
    // text doesn't sit highlighted behind the modal.
    window.getSelection()?.removeAllRanges();
    setOpen(true);
  }

  // Reopening starts clean: a failed attempt's error must not greet the next one.
  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("notes") ?? "");
    setError(null);
    startTransition(async () => {
      const res = await save(studentEmail, text);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <section style={panelStyle}>
      <SectionLabel
        action={
          <button
            type="button"
            onClick={edit}
            style={link}
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            Edit
          </button>
        }
      >
        {title}
      </SectionLabel>
      <p onDoubleClick={edit} title="Double-click to edit" style={notes ? body : empty}>
        {notes || "No notes."}
      </p>

      {open && (
        <Modal label={`Edit ${title.toLowerCase()}`} onClose={close} maxWidth="480px">
          <form onSubmit={submit} style={formStyle}>
            <textarea
              name="notes"
              defaultValue={notes}
              placeholder={placeholder}
              rows={6}
              autoFocus
              aria-label={title}
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
    </section>
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

/** The whole note, line breaks kept; long unbroken strings wrap instead of overflowing. */
const body: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};
const empty: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--color-text-secondary)",
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
