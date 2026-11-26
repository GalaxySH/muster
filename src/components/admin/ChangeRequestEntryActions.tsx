"use client";

/**
 * Edit and Delete for one schedule change request on the per-student response
 * page, so an admin can fix a request's wording or drop it entirely. Sits in
 * the request's meta line, after the date.
 *
 * Deleting is permanent and takes any Drive proof with it, so it asks first.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { deleteChangeRequest, updateChangeRequest } from "@/lib/changes/admin-actions";
import { CHANGE_REQUEST_DAY_OPTIONS, type ChangeRequestDay } from "@/lib/domain/change-requests";
import { Modal } from "@/components/Modal";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { submitOnCtrlEnter } from "@/components/form-keys";
import { ActionMessage, Button, CheckRow, Field } from "@/components/admin/ui";

export function ChangeRequestEntryActions({
  id,
  day,
  shiftText,
  comment,
  permanent,
  fileCount,
}: {
  id: string;
  day: ChangeRequestDay;
  shiftText: string;
  comment: string;
  permanent: boolean;
  /** How many proof files the request carries (the delete prompt mentions them). */
  fileCount: number;
}) {
  const router = useRouter();
  const termId = useRenderedTermId();
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reopening starts clean: a failed attempt's error must not greet the next one.
  function close() {
    setOpen(null);
    setError(null);
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await updateChangeRequest(
        id,
        {
          day: String(form.get("day") ?? ""),
          shiftText: String(form.get("shiftText") ?? ""),
          comment: String(form.get("comment") ?? ""),
          permanent: form.get("permanent") === "1",
        },
        termId,
      );
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
      const res = await deleteChangeRequest(id, termId);
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
        onClick={() => setOpen("delete")}
        className="ad-linkbtn ad-linkbtn--danger ad-dg-inline"
      >
        Delete
      </button>

      {open === "edit" && (
        <Modal label="Edit change request" onClose={close} maxWidth="460px">
          <form onSubmit={save} className="ad-stack ad-dg-body">
            <div className="ad-fields">
              <Field label="Day">
                <select name="day" defaultValue={day}>
                  {CHANGE_REQUEST_DAY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shift time">
                <input type="text" name="shiftText" defaultValue={shiftText} required />
              </Field>
            </div>
            <CheckRow label="Permanent change">
              <input type="checkbox" name="permanent" value="1" defaultChecked={permanent} />
            </CheckRow>
            <Field label="Comment">
              <textarea
                name="comment"
                defaultValue={comment}
                required
                rows={4}
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
      )}

      {open === "delete" && (
        <Modal label="Delete change request" onClose={close} maxWidth="420px">
          <div className="ad-stack ad-dg-body">
            <p>
              Delete this request for good?
              {fileCount > 0 &&
                (fileCount === 1 ? " Its proof file goes too." : " Its proof files go too.")}
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
                pendingLabel="Deleting…"
              >
                Delete
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
