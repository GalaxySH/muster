"use client";

import { useState, useTransition } from "react";
import { setRunPinned } from "@/lib/schedule/actions";

/**
 * Pin or unpin a run from the run history table. No confirm step: both
 * directions are trivially reversible and neither touches the live schedule.
 */
export function PinRunButton({ runId, pinned }: { runId: string; pinned: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      const res = await setRunPinned(runId, !pinned);
      setError(res.ok ? null : (res.error ?? "Failed."));
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={toggle} disabled={pending}>
        {pending ? "Working…" : pinned ? "Unpin" : "Pin"}
      </button>
      {error && (
        <span role="status" style={{ fontSize: 13, color: "var(--color-text-danger)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
