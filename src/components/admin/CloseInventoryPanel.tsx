"use client";

/**
 * Admin inventory editor for SL weekend closes (PLAN §18a): a semester range +
 * one spots-per-shift capacity, generated into dated Fri/Sat slots. Regenerating
 * is safe: existing claims are always kept (slots that fall out of the range but
 * hold claims are reported, not removed).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateCloseInventory } from "@/lib/closes/admin-actions";
import { ActionButton } from "@/components/ui";

export function CloseInventoryPanel({
  defaults,
  hasSlots,
}: {
  defaults: { start: string; end: string; capacity: number };
  hasSlots: boolean;
}) {
  const router = useRouter();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [capacity, setCapacity] = useState(String(defaults.capacity));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await generateCloseInventory({ start, end, capacity: Number(capacity) });
      if (!res.ok || !res.summary) {
        setMsg({ ok: false, text: res.error ?? "Something went wrong." });
        return;
      }
      const s = res.summary;
      const parts = [
        `${s.created} shift${s.created === 1 ? "" : "s"} added`,
        `${s.capacityUpdated} capacity update${s.capacityUpdated === 1 ? "" : "s"}`,
        `${s.removed} removed`,
      ];
      if (s.keptWithClaims.length)
        parts.push(`kept outside the range because of claims: ${s.keptWithClaims.join(", ")}`);
      if (s.overClaimed.length)
        parts.push(`now over capacity: ${s.overClaimed.join(", ")}`);
      setMsg({ ok: true, text: `Inventory updated: ${parts.join("; ")}.` });
      router.refresh();
    });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={field}>
          From
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={input} />
        </label>
        <label style={field}>
          To
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={input} />
        </label>
        <label style={field}>
          Spots per shift
          <input
            type="number"
            min={1}
            max={20}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            style={{ ...input, width: 90 }}
          />
        </label>
        <ActionButton pending={pending} pendingLabel="Saving…" onClick={run}>
          {hasSlots ? "Update inventory" : "Generate inventory"}
        </ActionButton>
      </div>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "8px 0 0" }}>
        Creates a Friday and a Saturday close shift for every weekend in the range. Existing
        claims are always kept; shifts outside the range are removed only when nobody has
        claimed them.
      </p>
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
    </div>
  );
}

const field: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
};
const input: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  fontSize: 14,
};
