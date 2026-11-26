"use client";

import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { clearStudentSchedule } from "@/lib/schedule/manual";
import { ActionMessage, Button } from "@/components/admin/ui";

/**
 * Last resort: wipe this student's rows from the current schedule outright,
 * for when they're wrong in a way clicking cells off in the grid one at a
 * time, or deleting the whole response, is more trouble than it's worth.
 * Only ever shown when the student actually holds rows in the current run.
 * Two-step inline confirm: their availability answers are never touched, and
 * the next Update schedule can re-place them, but it's still a direct schedule
 * edit worth a deliberate second click.
 */
export function ClearStudentScheduleButton({
  studentEmail,
  count,
}: {
  studentEmail: string;
  count: number;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function clear() {
    setError(null);
    startTransition(async () => {
      const res = await clearStudentSchedule(studentEmail, termId);
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
        variant="danger"
        onClick={() => setConfirming(true)}
        title="Remove this student from the current schedule without touching their response"
      >
        Clear from schedule
      </Button>
    );
  }
  return (
    <span className="ad-row">
      <span>
        Remove {count === 1 ? "their 1 shift" : `all ${count} shifts`} from the current schedule?
      </span>
      <Button variant="danger-fill" onClick={clear} pending={pending} pendingLabel="Clearing…">
        Clear
      </Button>
      <Button onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      {error && <ActionMessage ok={false}>{error}</ActionMessage>}
    </span>
  );
}
