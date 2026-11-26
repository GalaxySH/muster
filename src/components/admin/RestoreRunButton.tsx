"use client";

import { useState, useTransition } from "react";
import { ActionMessage, Button } from "@/components/admin/ui";
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
    <span className="ad-sc-inline">
      {!confirming ? (
        <Button onClick={() => setConfirming(true)} pending={pending} pendingLabel="Restoring…">
          Restore
        </Button>
      ) : (
        <>
          <span>Make this run the current schedule?</span>
          <Button variant="primary" onClick={submit}>
            Yes, restore
          </Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </>
      )}
      {error && !confirming && <ActionMessage ok={false}>{error}</ActionMessage>}
    </span>
  );
}
