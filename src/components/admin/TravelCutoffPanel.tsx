"use client";

import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { setTravelCutoff, setLateTravelAccepted } from "@/lib/admin/actions";
import { toLocalInput, localInputToIso } from "@/components/admin/GroupWindowsTable";

/**
 * Admin editor for the term's travel-excusal cutoff (PLAN §8). One instant,
 * independent of the per-group form windows: students can add travel entries
 * until the cutoff; what happens after it is the late-policy toggle below the
 * date. Off (default), the travel step refuses new entries and locks the
 * existing ones ("refuse" in domain/travel.ts); on, entries stay accepted but
 * are stored late/unexcused ("accept-and-flag"). Reset puts the date back to
 * the term's default, the day before the semester starts. Nothing else moves
 * the cutoff: changing the semester's first day leaves it where it was set.
 */
export function TravelCutoffPanel({
  cutoffMs,
  isCustom,
  lateAccepted,
}: {
  cutoffMs: number;
  isCustom: boolean;
  lateAccepted: boolean;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [date, setDate] = useState(toLocalInput(cutoffMs));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function act(iso: string | null, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await setTravelCutoff(termId, iso);
      setMsg({ ok: res.ok, text: res.ok ? okText : (res.error ?? "Failed.") });
      if (res.ok) router.refresh();
    });
  }

  function toggleLate(accepted: boolean) {
    setMsg(null);
    startTransition(async () => {
      const res = await setLateTravelAccepted(termId, accepted);
      setMsg({
        ok: res.ok,
        text: res.ok
          ? accepted
            ? "Late travel is now accepted."
            : "Travel now closes at the cutoff."
          : (res.error ?? "Failed."),
      });
      if (res.ok) router.refresh();
    });
  }

  function save() {
    const iso = localInputToIso(date);
    if (!iso) {
      setMsg({ ok: false, text: "Pick a date, or use Reset to restore the default." });
      return;
    }
    act(iso, "Cutoff saved.");
  }

  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Travel excusal cutoff</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, marginTop: 0 }}>
        Students can add travel entries until <strong>00:00 (midnight)</strong> on this date. This
        date affects all groups.
        {!isCustom && " Currently the default, the day before the semester starts."}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
        <button type="button" disabled={pending} onClick={save}>
          Save cutoff
        </button>
        {isCustom && (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(null, "Reset to the default.")}
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
      <label style={lateToggle}>
        <input
          type="checkbox"
          checked={lateAccepted}
          disabled={pending}
          onChange={(e) => toggleLate(e.target.checked)}
        />
        <span>
          Accept late travel
          <span style={lateHint}>
            Students can keep adding travel after the cutoff. Those entries are marked late and are
            not excused.
          </span>
        </span>
      </label>
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
const lateToggle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  marginTop: 12,
  fontSize: 14,
  cursor: "pointer",
};
const lateHint: React.CSSProperties = {
  display: "block",
  color: "var(--color-text-secondary)",
  fontSize: 13,
};
