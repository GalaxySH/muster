"use client";

import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { Button } from "@/components/admin/ui";
import { saveScheduleRunSnapshot } from "@/lib/schedule/actions";

/**
 * Checkpoint the current schedule into run history without regenerating. The
 * live current run is never touched, so no confirm step is needed.
 */
export function SaveRunButton() {
  const termId = useRenderedTermId();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await saveScheduleRunSnapshot(termId);
      if (!res.ok) {
        setMsg(res.error ?? "Failed.");
        return;
      }
      setMsg(`Saved: ${res.assignments} assignments.`);
    });
  };

  return (
    <span className="ad-sc-inline">
      <Button onClick={submit} pending={pending} pendingLabel="Saving…">
        Save run
      </Button>
      {msg && (
        <span role="status" className="ad-muted">
          {msg}
        </span>
      )}
    </span>
  );
}
