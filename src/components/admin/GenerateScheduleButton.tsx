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
  const [includeNonResponders, setIncludeNonResponders] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [repairOnly, setRepairOnly] = useState(false);
  const [pending, startTransition] = useTransition();

  const label = hasRun ? "Update schedule" : "Generate schedule";

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await generateSchedule({ repairFromPlan: repairOnly, includeNonResponders });
      if (!res.ok) {
        setMsg(res.error ?? "Failed.");
        return;
      }
      const repairNote = res.repaired ? repairSummary(res.repaired) : "";
      setMsg(`Schedule updated: ${res.placed} assignments.${repairNote}`);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={includeNonResponders}
          onChange={(e) => setIncludeNonResponders(e.target.checked)}
          disabled={pending}
          style={{ marginTop: 2 }}
        />
        <span>
          Also schedule people who did not respond
          <span style={{ display: "block", color: "var(--color-text-secondary)" }}>
            Fills leftover shifts with roster members who never submitted, as if they are available
            anytime.
          </span>
        </span>
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {!confirming ? (
          <button
            type="button"
            onClick={() => {
              setRepairOnly(false);
              setConfirming(true);
            }}
            disabled={pending}
          >
            {pending ? "Working…" : label}
          </button>
        ) : (
          <>
            <span style={{ fontSize: 13 }}>
              {includeNonResponders
                ? `${hasRun ? "Rebuild" : "Generate"} recommendations, including people who did not respond?`
                : hasRun
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
      {hasPlan && (
        <details style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          <summary style={{ cursor: "pointer" }}>What normal and repair updates do</summary>
          <p style={{ margin: "6px 0 4px", maxWidth: 640 }}>
            <strong>Normal update</strong> rebuilds the recommendation from scratch for everyone not
            marked scheduled, using the current responses and staffing targets. Any placement can
            move.
          </p>
          <p style={{ margin: 0, maxWidth: 640 }}>
            <strong>Repair only</strong> starts from the imported W2W plan instead. Every placement
            named on the plan that still works is kept exactly where it is, and the engine only
            fills open seats. If one of a student&apos;s kept placements no longer works, that
            student is re-solved completely. The keep lasts for this run; the next normal update can
            move them again.
          </p>
          <p style={{ margin: "4px 0 0", maxWidth: 640 }}>
            The option above to include people who did not respond applies to either kind of
            update.
          </p>
        </details>
      )}
    </div>
  );
}

/** One line on what repair mode kept and what fell back to the engine. */
function repairSummary(r: NonNullable<Awaited<ReturnType<typeof generateSchedule>>["repaired"]>) {
  let note = ` Kept ${r.students} students where the plan places them (${r.cells} shifts).`;
  if (r.brokenStudents.length > 0) {
    note +=
      r.brokenStudents.length === 1
        ? " 1 student had a placement that no longer fits and was fully re-solved."
        : ` ${r.brokenStudents.length} students had a placement that no longer fits and were fully re-solved.`;
  }
  if (r.skippedNames.length > 0) {
    const shown = r.skippedNames.slice(0, 5).join(", ");
    const more = r.skippedNames.length - 5;
    note += ` Names nobody matches: ${shown}${more > 0 ? ` and ${more} more` : ""}.`;
  }
  if (r.skippedCells > 0) {
    note += ` ${r.skippedCells} shifts name people who are off the roster, not submitted, or marked scheduled.`;
  }
  return note;
}
