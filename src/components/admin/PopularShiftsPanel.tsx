"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHighDemandMarksEnabled } from "@/lib/admin/actions";

/**
 * Whether the availability form marks its busiest shifts for students (the red
 * bar, roadmap 2.5). On by default. Off drops the marks and their legend from
 * the student grid only: the admin per-student grid and the coverage grids keep
 * showing the same cells.
 */
export function PopularShiftsPanel({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(next: boolean) {
    setEnabled(next);
    setMsg(null);
    startTransition(async () => {
      const res = await setHighDemandMarksEnabled(next);
      if (!res.ok) {
        setEnabled(!next);
        setMsg({ ok: false, text: res.error ?? "Failed." });
        return;
      }
      setMsg({
        ok: true,
        text: next
          ? "Students see the popular shift marks."
          : "The marks are hidden from students.",
      });
      router.refresh();
    });
  }

  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Popular shifts</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, marginTop: 0 }}>
        The availability form puts a red bar on the shifts the most students have already picked, so
        they can steer toward the quieter ones.
      </p>
      <label style={toggleRow}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          Show the red bar to students
          <span style={hint}>
            Your own grids keep the marks either way, on the per-student page and the schedule.
          </span>
        </span>
      </label>
      {msg && (
        <p
          role="status"
          style={{
            margin: "8px 0 0",
            fontSize: 13,
            color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
          }}
        >
          {msg.ok ? "✓ " : "✗ "}
          {msg.text}
        </p>
      )}
    </section>
  );
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const toggleRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  fontSize: 14,
  cursor: "pointer",
};
const hint: React.CSSProperties = {
  display: "block",
  color: "var(--color-text-secondary)",
  fontSize: 13,
};
