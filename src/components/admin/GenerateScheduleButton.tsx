"use client";

import { useState, useTransition } from "react";
import { generateSchedule } from "@/lib/schedule/actions";

/**
 * The "Update schedule" action on /admin/schedule with a two-step confirm.
 * No typed phrase is needed: students marked scheduled are structurally frozen
 * in the engine and every run is kept, so the worst case is one click away
 * from being restored.
 */
export function GenerateScheduleButton({ hasRun }: { hasRun: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [includeNonResponders, setIncludeNonResponders] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = hasRun ? "Update schedule" : "Generate schedule";

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await generateSchedule({ includeNonResponders });
      setMsg(res.ok ? `Schedule updated: ${res.placed} assignments.` : (res.error ?? "Failed."));
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
          <button type="button" onClick={() => setConfirming(true)} disabled={pending}>
            {pending ? "Working…" : label}
          </button>
        ) : (
          <>
            <span style={{ fontSize: 13 }}>
              {includeNonResponders
                ? "Rebuild recommendations, including people who did not respond?"
                : hasRun
                  ? "Rebuild recommendations for everyone not marked scheduled?"
                  : "Generate recommendations for every submitted response?"}
            </span>
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
    </div>
  );
}
