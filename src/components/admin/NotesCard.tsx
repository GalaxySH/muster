"use client";

/**
 * A free-text notes card on the per-student page: the full text as readable
 * paragraphs, edited in a modal opened by the header's "Edit" or by
 * double-clicking the text, saved by the Save button or Ctrl+Enter. One
 * mechanism for both notes the page carries:
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
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { saveSchedulerNotes } from "@/lib/admin/actions";
import { saveStudentNotesFor } from "@/lib/availability/actions";
import { Modal } from "@/components/Modal";
import { submitOnCtrlEnter } from "@/components/form-keys";
import { ActionMessage, Button, Field, Panel } from "@/components/admin/ui";

export type NotesKind = "scheduling" | "student";

const KINDS: Record<
  NotesKind,
  {
    title: string;
    placeholder: string;
    save: (
      email: string,
      notes: string,
      termId: string,
    ) => Promise<{ ok: boolean; error?: string }>;
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
  const termId = useRenderedTermId();
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
      const res = await save(studentEmail, text, termId);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      close();
      router.refresh();
    });
  }

  const editLink = (
    <button
      type="button"
      onClick={edit}
      className="ad-linkbtn"
      aria-label={`Edit ${title.toLowerCase()}`}
    >
      Edit
    </button>
  );

  const editor = open && (
    <Modal label={`Edit ${title.toLowerCase()}`} onClose={close} maxWidth="480px">
      <form onSubmit={submit} className="ad-stack ad-dg-body">
        <Field label={title}>
          <textarea
            name="notes"
            defaultValue={notes}
            placeholder={placeholder}
            rows={6}
            autoFocus
            onKeyDown={submitOnCtrlEnter}
            className="ad-input--block"
          />
        </Field>
        {error && (
          <ActionMessage ok={false} as="p">
            {error}
          </ActionMessage>
        )}
        <div className="ad-actions">
          <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving…">
            Save
          </Button>
          <Button disabled={pending} onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );

  // With nothing written the card is a single line.
  if (!notes) {
    return (
      <Panel title={title} line={<span onDoubleClick={edit}>No notes.</span>} aside={editLink}>
        {editor}
      </Panel>
    );
  }

  return (
    <Panel title={title} aside={editLink}>
      {/* The whole note, line breaks kept. */}
      <p onDoubleClick={edit} className="ad-prewrap ad-dg-notes-body">
        {notes}
      </p>
      {editor}
    </Panel>
  );
}
