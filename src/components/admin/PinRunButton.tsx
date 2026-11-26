"use client";

import { useState, useTransition } from "react";
import { ActionMessage, Button } from "@/components/admin/ui";
import { setRunPinned } from "@/lib/schedule/actions";

/**
 * Pin or unpin a run. No confirm step: both directions are trivially
 * reversible and neither touches the live schedule. `current` is for the copy
 * beside Save run, which names the run it acts on so it reads apart from the
 * history rows.
 */
export function PinRunButton({
  runId,
  pinned,
  current = false,
}: {
  runId: string;
  pinned: boolean;
  current?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      const res = await setRunPinned(runId, !pinned);
      setError(res.ok ? null : (res.error ?? "Failed."));
    });
  };

  return (
    <span className="ad-sc-inline">
      <Button
        onClick={toggle}
        pending={pending}
        aria-label={current ? `${pinned ? "Unpin" : "Pin"} the current run` : undefined}
      >
        {pinned ? "Unpin" : "Pin"}
      </Button>
      {error && <ActionMessage ok={false}>{error}</ActionMessage>}
    </span>
  );
}
