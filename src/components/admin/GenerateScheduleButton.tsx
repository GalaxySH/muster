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
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = hasRun ? "Update schedule" : "Generate schedule";

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await generateSchedule();
      setMsg(res.ok ? `Schedule updated: ${res.placed} assignments.` : (res.error ?? "Failed."));
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} disabled={pending} style={primary}>
          {pending ? "Working…" : label}
        </button>
      ) : (
        <>
          <span style={{ fontSize: 13 }}>
            {hasRun
              ? "Rebuild recommendations for everyone not marked scheduled?"
              : "Generate recommendations for every submitted response?"}
          </span>
          <button type="button" onClick={submit} style={primary}>
            Yes, {hasRun ? "update" : "generate"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} style={secondary}>
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

const primary: React.CSSProperties = {
  borderRadius: 8,
  padding: "6px 14px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid var(--color-border-primary)",
  background: "var(--color-background-primary)",
};

const secondary: React.CSSProperties = {
  ...primary,
  fontWeight: 400,
};
