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
import { ActionButton } from "@/components/ui";

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
      const res = await updateChangeRequest(id, {
        day: String(form.get("day") ?? ""),
        shiftText: String(form.get("shiftText") ?? ""),
        comment: String(form.get("comment") ?? ""),
        permanent: form.get("permanent") === "1",
      });
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
      const res = await deleteChangeRequest(id);
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
      <button type="button" onClick={() => setOpen("edit")} style={link}>
        Edit
      </button>
      <button type="button" onClick={() => setOpen("delete")} style={{ ...link, ...danger }}>
        Delete
      </button>

      {open === "edit" && (
        <Modal label="Edit change request" onClose={close} maxWidth="460px">
          <form onSubmit={save} style={formStyle}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={field}>
                Day
                <select name="day" defaultValue={day} style={{ padding: 6 }}>
                  {CHANGE_REQUEST_DAY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...field, flex: 1, minWidth: 160 }}>
                Shift time
                <input
                  type="text"
                  name="shiftText"
                  defaultValue={shiftText}
                  required
                  style={{ padding: 6 }}
                />
              </label>
            </div>
            <label style={checkboxRow}>
              <input type="checkbox" name="permanent" value="1" defaultChecked={permanent} />
              Permanent change
            </label>
            <label style={field}>
              Comment
              <textarea
                name="comment"
                defaultValue={comment}
                required
                rows={4}
                style={{ padding: 6, fontFamily: "inherit" }}
              />
            </label>
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

      {open === "delete" && (
        <Modal label="Delete change request" onClose={close} maxWidth="420px">
          <div style={formStyle}>
            <p style={{ margin: 0, fontSize: 14 }}>
              Delete this request for good?
              {fileCount > 0 &&
                (fileCount === 1 ? " Its proof file goes too." : " Its proof files go too.")}
            </p>
            <p role="status" style={errorSlot}>
              {error}
            </p>
            <div style={buttonRow}>
              <ActionButton variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </ActionButton>
              {/* Destructive, so it takes the outlined danger button the
                  travel entry's Remove uses rather than the primary one. */}
              <button
                type="button"
                className="btn-hover"
                onClick={remove}
                disabled={pending}
                style={dangerButton(pending)}
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Quiet text links, sized to sit in the request's small meta line. */
const link: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  marginLeft: 10,
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-text-info)",
  cursor: "pointer",
};
const danger: React.CSSProperties = { color: "var(--color-text-danger)" };

/** One size for the box's whole life, so an error never moves the buttons. */
const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "100%",
  fontSize: 14,
};
const field: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const checkboxRow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  cursor: "pointer",
};
const errorSlot: React.CSSProperties = {
  margin: 0,
  minHeight: 32,
  fontSize: 13,
  color: "var(--color-text-danger)",
};
const buttonRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
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
