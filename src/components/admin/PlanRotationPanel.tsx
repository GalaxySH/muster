"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlanRotationWeek } from "@/lib/w2w/actions";

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
  const [msg, setMsg] = useState<string | null>(null);

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
      setMsg(res.ok ? `Now rotation ${week.toUpperCase()}.` : (res.error ?? "Failed."));
      if (res.ok) router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Weekend rotation</span>
      {(["a", "b"] as const).map((week) => (
        <label key={week} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 14 }}>
          <input
            type="radio"
            name="rotationWeek"
            checked={rotationWeek === week}
            disabled={pending}
            onChange={() => pick(week)}
          />
          Week {week.toUpperCase()}
        </label>
      ))}
      {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
    </div>
  );
}
