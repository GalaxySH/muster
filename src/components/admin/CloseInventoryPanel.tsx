"use client";

/**
 * Admin inventory editor for SL weekend closes (PLAN §18a): a semester range +
 * one spots-per-shift capacity, generated into dated Fri/Sat slots. Regenerating
 * is safe: existing claims are always kept (slots that fall out of the range but
 * hold claims are reported, not removed).
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { generateCloseInventory } from "@/lib/closes/admin-actions";
import { ActionMessage, Button, Field, Notice } from "@/components/admin/ui";

export function CloseInventoryPanel({
  defaults,
  hasSlots,
}: {
  defaults: { start: string; end: string; capacity: number };
  hasSlots: boolean;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [capacity, setCapacity] = useState(String(defaults.capacity));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await generateCloseInventory(termId, { start, end, capacity: Number(capacity) });
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
      if (s.overClaimed.length) parts.push(`now over capacity: ${s.overClaimed.join(", ")}`);
      setMsg({ ok: true, text: `Inventory updated: ${parts.join("; ")}.` });
      router.refresh();
    });
  }

  return (
    <div className="ad-stack ad-stack--tight">
      <div className="ad-row ad-row--end">
        <Field label="From">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Spots per shift">
          <input
            type="number"
            min={1}
            max={20}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="ad-pl-spots-input"
          />
        </Field>
        <Button variant="primary" pending={pending} pendingLabel="Saving…" onClick={run}>
          {hasSlots ? "Update inventory" : "Generate inventory"}
        </Button>
      </div>
      <p className="ad-help">
        Creates a Fri/Sat close shift for every weekend in range. Assignments will remain even if
        the range is changed.
      </p>
      {msg &&
        (msg.ok ? (
          <ActionMessage ok as="p">
            {msg.text}
          </ActionMessage>
        ) : (
          <Notice tone="danger" role="alert">
            {msg.text}
          </Notice>
        ))}
    </div>
  );
}
