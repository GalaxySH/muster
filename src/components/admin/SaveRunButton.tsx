"use client";

import { useState, useTransition } from "react";
import { saveScheduleRunSnapshot } from "@/lib/schedule/actions";

/**
 * Checkpoint the current schedule into run history without regenerating. The
 * live current run is never touched, so no confirm step is needed.
 */
export function SaveRunButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await saveScheduleRunSnapshot();
      if (!res.ok) {
        setMsg(res.error ?? "Failed.");
        return;
      }
      setMsg(`Saved: ${res.assignments} assignments.`);
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <button type="button" onClick={submit} disabled={pending}>
        {pending ? "Saving…" : "Save run"}
      </button>
      {msg && (
        <span role="status" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {msg}
        </span>
      )}
    </span>
  );
}
