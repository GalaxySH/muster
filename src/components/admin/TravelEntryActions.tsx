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
import { useRouter } from "next/navigation";
import { removeTravelRequest, updateTravelRequest } from "@/lib/evidence/actions";
import { Modal } from "@/components/Modal";
import { ActionButton } from "@/components/ui";

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
      const res = await removeTravelRequest(id, studentEmail);
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
      <button type="button" onClick={() => setOpen("remove")} style={{ ...link, ...danger }}>
        Remove
      </button>

      {open === "edit" && (
        <Modal label="Edit travel entry" onClose={close} maxWidth="420px">
          <form onSubmit={save} style={formStyle}>
            <input type="hidden" name="student" value={studentEmail} />
            <input type="hidden" name="id" value={id} />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={field}>
                Start
                <input type="date" name="startDate" defaultValue={startDate} required />
              </label>
              <label style={field}>
                End
                <input type="date" name="endDate" defaultValue={endDate} required />
              </label>
            </div>
            <label style={field}>
              Note (optional)
              <input type="text" name="note" defaultValue={note ?? ""} style={{ padding: 6 }} />
            </label>
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-tertiary)" }}>
              To change the proof, remove this entry and add it again.
            </p>
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

      {open === "remove" && (
        <Modal label="Remove travel entry" onClose={close} maxWidth="420px">
          <div style={formStyle}>
            <p style={{ margin: 0, fontSize: 14 }}>
              Remove the {startDate} to {endDate} entry? This deletes the proof too.
            </p>
            <p role="status" style={errorSlot}>
              {error}
            </p>
            <div style={buttonRow}>
              <ActionButton variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </ActionButton>
              {/* Destructive, so it takes the outlined danger button the
                  response delete already uses rather than the primary one. */}
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

/** Quiet text links, sized to sit in the entry beside the resolved checkbox. */
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
