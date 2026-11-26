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
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { removeCourseSchedule, removeExtracurricularFile } from "@/lib/evidence/actions";
import { Modal } from "@/components/Modal";
import { ActionMessage, Button } from "@/components/admin/ui";

type RemoveTarget = { kind: "course" } | { kind: "extracurricular"; rowId: string };

const COPY = {
  course: { title: "Remove course schedule", prompt: "Remove the course schedule on file?" },
  extracurricular: { title: "Remove proof", prompt: "Remove this proof?" },
} as const;

export function RemoveEvidenceButton(props: RemoveTarget & { studentEmail: string }) {
  const termId = useRenderedTermId();
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
          ? await removeCourseSchedule(props.studentEmail, termId)
          : await removeExtracurricularFile(props.rowId, props.studentEmail, termId);
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
      {/* Beside Replace in the card header, or smaller under a proof thumbnail. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.title}
        className={
          props.kind === "course"
            ? "ad-linkbtn ad-linkbtn--danger"
            : "ad-linkbtn ad-linkbtn--danger ad-small"
        }
      >
        Remove
      </button>

      {open && (
        <Modal label={copy.title} onClose={close} maxWidth="420px">
          <div className="ad-stack ad-dg-body">
            <p>{copy.prompt} This deletes the file too.</p>
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
