"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTravelCutoff } from "@/lib/admin/actions";
import { toLocalInput, localInputToIso } from "@/components/admin/GroupWindowsTable";

/**
 * Admin editor for the travel-excusal cutoff (PLAN §8). One global instant,
 * independent of the per-group form windows: students can add travel entries
 * until the cutoff; after it the travel step refuses new entries and locks the
 * existing ones (the "refuse" late policy in domain/travel.ts). Clearing the
 * date reverts to the 9/1 default.
 */
export function TravelCutoffPanel({
  cutoffMs,
  isCustom,
}: {
  cutoffMs: number;
  isCustom: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(toLocalInput(cutoffMs));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function act(iso: string | null, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await setTravelCutoff(iso);
      setMsg({ ok: res.ok, text: res.ok ? okText : (res.error ?? "Failed.") });
      if (res.ok) router.refresh();
    });
  }

  function save() {
    const iso = localInputToIso(date);
    if (!iso) {
      setMsg({ ok: false, text: "Pick a date (or use Reset to restore the 9/1 default)." });
      return;
    }
    act(iso, "Cutoff saved.");
  }

  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Travel excusal cutoff</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, marginTop: 0 }}>
        Students can add travel entries until <strong>00:00 (midnight)</strong> on this date. This date affects all groups.
        {!isCustom && " Currently the September 1 default."}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={input}
        />
        <button type="button" disabled={pending} onClick={save}>
          Save cutoff
        </button>
        {isCustom && (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(null, "Reset to the September 1 default.")}
          >
            Reset to default
          </button>
        )}
        {msg && (
          <span
            role="status"
            style={{
              fontSize: 13,
              color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
            }}
          >
            {msg.ok ? "✓ " : "✗ "}
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const input: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
};
