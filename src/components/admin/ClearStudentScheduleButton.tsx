"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearStudentSchedule } from "@/lib/schedule/manual";

/**
 * Last resort: wipe this student's rows from the current schedule outright,
 * for when they're wrong in a way clicking cells off in the grid one at a
 * time, or deleting the whole response, is more trouble than it's worth.
 * Only ever shown when the student actually holds rows in the current run.
 * Two-step inline confirm, kept quiet rather than styled as a primary action:
 * their availability answers are never touched, and the next Update schedule
 * can re-place them, but it's still a direct schedule edit worth a deliberate
 * second click.
 */
export function ClearStudentScheduleButton({
  studentEmail,
  count,
}: {
  studentEmail: string;
  count: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function clear() {
    setError(null);
    startTransition(async () => {
      const res = await clearStudentSchedule(studentEmail);
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={quietBtn}
        title="Remove this student from the current schedule without touching their response"
      >
        Clear from schedule
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12 }}>
        Remove {count === 1 ? "their 1 shift" : `all ${count} shifts`} from the current schedule?
      </span>
      <button type="button" onClick={clear} disabled={pending} style={dangerBtn}>
        {pending ? "Clearing…" : "Clear"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        style={quietBtn}
      >
        Cancel
      </button>
      {error && <span style={{ fontSize: 12, color: "var(--color-text-danger)" }}>{error}</span>}
    </span>
  );
}

const quietBtn: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 10px",
  borderRadius: "var(--border-radius-md)",
  cursor: "pointer",
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

const dangerBtn: React.CSSProperties = {
  ...quietBtn,
  fontWeight: 600,
  border: "1px solid var(--color-text-danger)",
  background: "var(--color-text-danger)",
  color: "#fff",
};
