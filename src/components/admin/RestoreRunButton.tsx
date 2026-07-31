"use client";

import { useState, useTransition } from "react";
import { restoreScheduleRun } from "@/lib/schedule/actions";

/**
 * Restore a superseded run from the run history table, with the same light
 * two-step confirm as the Update button: the flip is in place and reversible
 * (the replaced run stays in the history), so no typed phrase is needed.
 */
export function RestoreRunButton({ runId }: { runId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await restoreScheduleRun(runId);
      setError(res.ok ? null : (res.error ?? "Restore failed."));
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} disabled={pending}>
          {pending ? "Restoring…" : "Restore"}
        </button>
      ) : (
        <>
          <span style={{ fontSize: 13 }}>Make this run the current schedule?</span>
          <button type="button" onClick={submit}>
            Yes, restore
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
