"use client";

/**
 * The requested-hours figure in the fact strip of a student's page, editable in
 * place. It reads as the figure with a dotted underline, turns into a small
 * number box on click, and saves on Enter or blur;
 * Escape backs out. An empty box clears the answer.
 *
 * The save overwrites the student's own desired hours (`saveDesiredHoursFor`),
 * which runs the same floor check the student form does. The page refreshes
 * afterwards so the grid calculator, which reads the same number, follows.
 */
import { useRef, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { saveDesiredHoursFor } from "@/lib/availability/actions";
import { ActionMessage } from "@/components/admin/ui";

export function RequestedHoursEditor({
  studentEmail,
  desiredHours,
  minHours,
}: {
  studentEmail: string;
  desiredHours: number | null;
  /** The position floor, the same `min` the student form's input carries. */
  minHours: number;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  // Shown straight away on a save, so the old figure never flashes back while
  // the refresh is in flight. The page keys this on the stored value, so a
  // change from anywhere else starts it fresh.
  const [value, setValue] = useState(desiredHours);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Enter saves and then the box goes away, which can blur it too. One save
  // per edit, whichever of the two gets there first.
  const busy = useRef(false);

  function open() {
    setDraft(value?.toString() ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function commit() {
    if (!editing || busy.current) return;
    const text = draft.trim();
    const hours = text === "" ? null : Number(text);
    if (hours === value) {
      cancel();
      return;
    }
    if (hours !== null && !Number.isFinite(hours)) {
      setError("Enter a number of hours.");
      return;
    }
    busy.current = true;
    setError(null);
    startTransition(async () => {
      const res = await saveDesiredHoursFor(studentEmail, hours, termId);
      busy.current = false;
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setValue(hours);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <span className="ad-st-hours">
        <input
          type="number"
          min={minHours}
          step={1}
          value={draft}
          autoFocus
          disabled={pending}
          aria-label="Requested hours"
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="ad-st-hours-input"
        />
        {error && <ActionMessage ok={false}>{error}</ActionMessage>}
      </span>
    );
  }

  return (
    <button type="button" title="Click to edit" onClick={open} className="ad-st-figure">
      {value ? `${value}h` : "D"}
    </button>
  );
}
