"use client";

/**
 * The Start/End pair both travel entry forms use: the student's own /travel form
 * and the admin's add-entry modal on the response page. Start opens on today and
 * End follows it up, so a one-day trip is a single pick and an end date never
 * sits before its start. The rule has to hold the same way in both places, so it
 * lives here rather than in each form.
 *
 * The inputs stay uncontrolled on purpose: /travel clears its form with
 * `form.reset()` after a successful add (see `useEvidenceRunner`), which a
 * React-held value would quietly stop honoring. The server re-checks the range
 * either way (lib/evidence/actions.ts).
 */
import { useEffect, useRef, useState } from "react";
import { localDay } from "@/lib/domain/calendar-day";

export function TravelDateRange({
  layout = "stacked",
  disabled = false,
}: {
  /** "stacked" puts each label above its input (the admin modal); "inline" beside it. */
  layout?: "stacked" | "inline";
  disabled?: boolean;
}) {
  const endRef = useRef<HTMLInputElement>(null);
  const [today, setToday] = useState("");

  // Read after mount, never during the server render: "today" means the viewer's
  // today, and the server's clock can already be on the next date.
  useEffect(() => setToday(localDay(new Date())), []);

  // A start after the end is not a range, so the end comes up with it. An end the
  // user picked that still follows the start is left where they put it.
  function syncEnd(start: string) {
    const end = endRef.current;
    if (!end || !start) return;
    if (!end.value || end.value < start) end.value = start;
  }

  const labelStyle = layout === "inline" ? inlineLabel : stackedLabel;
  return (
    <div style={row}>
      <label style={labelStyle}>
        Start{" "}
        <input
          type="date"
          name="startDate"
          required
          disabled={disabled}
          defaultValue={today}
          onChange={(e) => syncEnd(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        End <input type="date" name="endDate" required disabled={disabled} ref={endRef} />
      </label>
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
};
/** The student form runs its labels beside the inputs; the admin modal stacks them. */
const inlineLabel: React.CSSProperties = { fontSize: 14 };
const stackedLabel: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
