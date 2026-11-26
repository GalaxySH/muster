"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlanRotationWeek } from "@/lib/w2w/actions";
import { ActionMessage, CheckRow } from "@/components/admin/ui";

/**
 * Correct the current plan's weekend rotation without re-uploading it. The
 * choice is made once at upload and is easy to get wrong; it decides which
 * cohort a weekend name is read as when a schedule is generated from the plan.
 */
export function PlanRotationPanel({
  planId,
  rotationWeek,
}: {
  planId: string;
  rotationWeek: "a" | "b";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function pick(week: "a" | "b") {
    if (week === rotationWeek) return;
    if (
      !confirm(
        `Change the current plan to weekend rotation ${week.toUpperCase()}?\n\n` +
          "Generating a schedule from this plan will put its weekend names in the other rotation.",
      )
    ) {
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await setPlanRotationWeek(planId, week);
      setMsg({
        ok: res.ok,
        text: res.ok ? `Now rotation ${week.toUpperCase()}.` : (res.error ?? "Failed."),
      });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="ad-pl-rotation" role="radiogroup" aria-label="Weekend rotation">
      <span className="ad-pl-rotation-label">Weekend rotation:</span>
      {(["a", "b"] as const).map((week) => (
        <CheckRow key={week} label={`Week ${week.toUpperCase()}`}>
          <input
            type="radio"
            name="rotationWeek"
            checked={rotationWeek === week}
            disabled={pending}
            onChange={() => pick(week)}
          />
        </CheckRow>
      ))}
      {msg && <ActionMessage ok={msg.ok}>{msg.text}</ActionMessage>}
    </div>
  );
}
