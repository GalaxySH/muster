"use client";

import { useState, useTransition } from "react";
import { useRenderedTermId, useRenderedTermName } from "@/components/RenderedTerm";
import { Button, CheckRow } from "@/components/admin/ui";
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
  const termId = useRenderedTermId();
  const termName = useRenderedTermName();
  const [confirming, setConfirming] = useState(false);
  const [unmark, setUnmark] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await clearScheduleRun(termId, unmark);
      setError(res.ok ? null : (res.error ?? "Clear failed."));
    });
  };

  return (
    <span className="ad-sc-inline">
      {!confirming ? (
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
          pending={pending}
          pendingLabel="Clearing…"
        >
          Clear schedule
        </Button>
      ) : (
        <>
          <span>Empty the {termName} schedule? You can restore it from the run history.</span>
          {markedScheduled > 0 && (
            <CheckRow
              label={
                markedScheduled === 1
                  ? "Also unmark 1 student as scheduled"
                  : `Also unmark ${markedScheduled} students as scheduled`
              }
            >
              <input
                type="checkbox"
                checked={unmark}
                onChange={(e) => setUnmark(e.target.checked)}
              />
            </CheckRow>
          )}
          <Button variant="danger-fill" onClick={submit}>
            Yes, clear
          </Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </>
      )}
      {error && !confirming && (
        <span role="status" className="ad-danger-text">
          {error}
        </span>
      )}
    </span>
  );
}
