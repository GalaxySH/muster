"use client";

/**
 * The requested-hours figure on the response page's REQUESTED tile, editable in
 * place. It reads as plain text until hovered (a dotted underline is the only
 * hint), turns into a small number box on click, and saves on Enter or blur;
 * Escape backs out. An empty box clears the answer.
 *
 * The save overwrites the student's own desired hours (`saveDesiredHoursFor`),
 * which runs the same floor check the student form does. The page refreshes
 * afterwards so the grid calculator, which reads the same number, follows.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDesiredHoursFor } from "@/lib/availability/actions";

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
  const router = useRouter();
  // Shown straight away on a save, so the old figure never flashes back while
  // the refresh is in flight. The page keys this on the stored value, so a
  // change from anywhere else starts it fresh.
  const [value, setValue] = useState(desiredHours);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hover, setHover] = useState(false);
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
      const res = await saveDesiredHoursFor(studentEmail, hours);
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
      <span style={{ display: "inline-flex", flexDirection: "column", verticalAlign: "top" }}>
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
          style={input}
        />
        {error && (
          <span role="alert" style={errorText}>
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Click to edit"
      onClick={open}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={hover ? { ...figure, ...figureHover } : figure}
    >
      {value ? `${value}h` : "D"}
    </button>
  );
}

/** Looks exactly like the tile's other text until hovered. */
const figure: React.CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "none",
  border: "none",
  padding: "0 2px",
  margin: "0 -2px",
  borderRadius: 4,
  cursor: "pointer",
  textDecoration: "underline dotted transparent",
  textUnderlineOffset: 4,
};
const figureHover: React.CSSProperties = {
  textDecorationColor: "var(--color-text-tertiary)",
  background: "var(--color-background-primary)",
};

const input: React.CSSProperties = {
  width: "4.5em",
  font: "inherit",
  padding: "0 4px",
  borderRadius: 4,
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
};
const errorText: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: "var(--color-text-danger)",
};
