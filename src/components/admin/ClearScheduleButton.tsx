"use client";

import { useState, useTransition } from "react";
import { clearScheduleRun } from "@/lib/schedule/actions";

/**
 * Empty the current schedule. Two-step inline confirm rather than a typed
 * phrase or a window.confirm: the cleared schedule is still in run history and
 * one click of Restore brings it back.
 *
 * The checkbox is ticked by default because a student left marked scheduled
 * keeps a freeze with no rows behind it, and the next update would leave them
 * with nothing.
 */
export function ClearScheduleButton({ markedScheduled }: { markedScheduled: number }) {
  const [confirming, setConfirming] = useState(false);
  const [unmark, setUnmark] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await clearScheduleRun(unmark);
      setError(res.ok ? null : (res.error ?? "Clear failed."));
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} disabled={pending}>
          {pending ? "Clearing…" : "Clear schedule"}
        </button>
      ) : (
        <>
          <span style={{ fontSize: 13, fontWeight: 400 }}>
            Empty the schedule? You can restore it from this list.
          </span>
          {markedScheduled > 0 && (
            <label style={{ fontSize: 13, fontWeight: 400, display: "inline-flex", gap: 5 }}>
              <input
                type="checkbox"
                checked={unmark}
                onChange={(e) => setUnmark(e.target.checked)}
              />
              {markedScheduled === 1
                ? "Also unmark 1 student as scheduled"
                : `Also unmark ${markedScheduled} students as scheduled`}
            </label>
          )}
          <button type="button" onClick={submit}>
            Yes, clear
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      )}
      {error && !confirming && (
        <span role="status" style={{ fontSize: 13, color: "var(--color-text-danger)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
