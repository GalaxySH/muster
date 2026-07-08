"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDefaultAutoAssign, runDefaultAssignmentSweep } from "@/lib/groups/actions";

/**
 * The default-assignment toggle + batch "Save" sweep (PLAN §13). The toggle only
 * governs whether ungrouped students are swept into the default group; the sweep
 * runs on Save and skips anyone already grouped or already auto-assigned.
 */
export function DefaultAssignmentPanel({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(next: boolean) {
    setEnabled(next);
    setMsg(null);
    startTransition(async () => {
      const res = await setDefaultAutoAssign(next);
      if (!res.ok) {
        setEnabled(!next);
        setMsg({ ok: false, text: res.error ?? "Failed." });
      } else {
        router.refresh();
      }
    });
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await runDefaultAssignmentSweep();
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Failed." });
      } else if (!res.enabled) {
        setMsg({ ok: true, text: "Default assignment is off. Nothing was swept." });
      } else {
        setMsg({
          ok: true,
          text: `Swept ${res.swept} ungrouped student${res.swept === 1 ? "" : "s"} into the default group.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Default assignment</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, marginTop: 0 }}>
        When on, clicking <strong>Save</strong> assigns every ungrouped student (and future
        self-adds) to the group marked <strong>default</strong> above. Already-grouped or
        previously auto-assigned students are left alone. Turning this off never un-assigns
        anyone.
      </p>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
        />
        Auto-assign ungrouped students to the default group
      </label>
      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={save} disabled={pending || !enabled}>
          {pending ? "Working…" : "Save (run default assignment)"}
        </button>
      </div>
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
