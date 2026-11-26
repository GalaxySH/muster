"use client";

import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { revertInternalAvailability } from "@/lib/availability/actions";
import { ActionMessage, Button } from "@/components/admin/ui";

/**
 * Drops the admin's internal availability copy so scheduling falls back to
 * the student's own answers (PLAN §10a). Two-step: the first click asks, the
 * second confirms, since the internal adjustments are gone for good.
 */
export function RevertInternalButton({ studentEmail }: { studentEmail: string }) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revert() {
    setError(null);
    startTransition(async () => {
      const res = await revertInternalAvailability(studentEmail, termId);
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
      <Button
        onClick={() => setConfirming(true)}
        title="Discard the adjustments and use the student's own availability"
      >
        Use student availability
      </Button>
    );
  }
  return (
    <span className="ad-row">
      <span>Discard the adjustments?</span>
      <Button variant="danger-fill" onClick={revert} pending={pending} pendingLabel="Reverting…">
        Discard
      </Button>
      <Button onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </Button>
      {error && <ActionMessage ok={false}>{error}</ActionMessage>}
    </span>
  );
}
