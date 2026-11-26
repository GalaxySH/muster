"use client";

/**
 * Edit and Remove for one travel entry on the per-student response page. Both
 * call the same evidence actions the student's own /travel page uses, with the
 * student named in a hidden field, so an admin can fix what somebody handed them
 * in person. Sits beside the resolved checkbox in the entry.
 *
 * Removing takes the Drive proof with it, so it asks first.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { removeTravelRequest, updateTravelRequest } from "@/lib/evidence/actions";
import { Modal } from "@/components/Modal";
import { ActionMessage, Button, Field } from "@/components/admin/ui";

export function TravelEntryActions({
  id,
  studentEmail,
  startDate,
  endDate,
  note,
}: {
  id: string;
  studentEmail: string;
  /** ISO dates, which is also what the date inputs take. */
  startDate: string;
  endDate: string;
  note: string | null;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reopening starts clean: a failed attempt's error must not greet the next one.
  function close() {
    setOpen(null);
    setError(null);
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await updateTravelRequest(formData);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      close();
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeTravelRequest(id, studentEmail, termId);
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
      <button type="button" onClick={() => setOpen("edit")} className="ad-linkbtn ad-dg-inline">
        Edit
      </button>
      <button
        type="button"
        onClick={() => setOpen("remove")}
        className="ad-linkbtn ad-linkbtn--danger ad-dg-inline"
      >
        Remove
      </button>

      {open === "edit" && (
        <Modal label="Edit travel entry" onClose={close} maxWidth="420px">
          <form onSubmit={save} className="ad-stack ad-dg-body">
            <input type="hidden" name="student" value={studentEmail} />
            <input type="hidden" name="termId" value={termId} />
            <input type="hidden" name="id" value={id} />
            <div className="ad-fields">
              <Field label="Start">
                <input type="date" name="startDate" defaultValue={startDate} required />
              </Field>
              <Field label="End">
                <input type="date" name="endDate" defaultValue={endDate} required />
              </Field>
            </div>
            <Field
              label="Note (optional)"
              help="To change the proof, remove this entry and add it again."
            >
              <input
                type="text"
                name="note"
                defaultValue={note ?? ""}
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
      )}

      {open === "remove" && (
        <Modal label="Remove travel entry" onClose={close} maxWidth="420px">
          <div className="ad-stack ad-dg-body">
            <p>
              Remove the {startDate} to {endDate} entry? This deletes the proof too.
            </p>
            {error && (
              <ActionMessage ok={false} as="p">
                {error}
              </ActionMessage>
            )}
            <div className="ad-actions">
              <Button
                variant="danger-fill"
                onClick={remove}
                pending={pending}
                pendingLabel="Removing…"
              >
                Remove
              </Button>
              <Button disabled={pending} onClick={close}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
