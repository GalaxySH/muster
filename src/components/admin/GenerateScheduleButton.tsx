"use client";

import { useState, useTransition } from "react";
import { generateSchedule } from "@/lib/schedule/actions";

/**
 * The "Update schedule" action on /admin/schedule with a two-step confirm.
 * No typed phrase is needed: students marked scheduled are structurally frozen
 * in the engine and every run is kept, so the worst case is one click away
 * from being restored.
 */
export function GenerateScheduleButton({ hasRun, hasPlan }: { hasRun: boolean; hasPlan: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [repairOnly, setRepairOnly] = useState(false);
  const [pending, startTransition] = useTransition();

  const label = hasRun ? "Update schedule" : "Generate schedule";

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await generateSchedule({ repairFromPlan: repairOnly });
      if (!res.ok) {
        setMsg(res.error ?? "Failed.");
        return;
      }
      const repairNote = res.repaired
        ? ` Kept ${res.repaired.students} students where the plan places them (${res.repaired.cells} shifts).` +
          (res.repaired.skippedNames.length > 0
            ? ` Names nobody matches: ${res.repaired.skippedNames.slice(0, 5).join(", ")}.`
            : "") +
          (res.repaired.skippedCells > 0
            ? res.repaired.skippedCells === 1
              ? " 1 placement no longer fit and was re-solved."
              : ` ${res.repaired.skippedCells} placements no longer fit and were re-solved.`
            : "")
        : "";
      setMsg(`Schedule updated: ${res.placed} assignments.${repairNote}`);
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} disabled={pending}>
          {pending ? "Working…" : label}
        </button>
      ) : (
        <>
          <span style={{ fontSize: 13 }}>
            {hasRun
              ? "Rebuild recommendations for everyone not marked scheduled?"
              : "Generate recommendations for every submitted response?"}
          </span>
          {hasPlan && (
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={repairOnly}
                onChange={(e) => setRepairOnly(e.target.checked)}
              />
              Repair only: keep everyone the imported W2W plan already places, fill gaps
            </label>
          )}
          <button type="button" onClick={submit}>
            Yes, {hasRun ? "update" : "generate"}
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      )}
      {msg && !confirming && (
        <span role="status" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {msg}
        </span>
      )}
    </div>
  );
}
