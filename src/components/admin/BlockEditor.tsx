"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InfoCard } from "@/components/ui";
import { deriveOpenClose } from "@/lib/domain/blocks";
import { blockSetWarnings, validateBlockTimes } from "@/lib/domain/config-validation";
import { hhmmToMinutes, minutesToHHMM } from "@/lib/domain/time";
import type { DayType, Position, ShiftBlock } from "@/lib/domain/types";
import { createBlock, deleteBlock, updateBlock } from "@/lib/positions/actions";
import type { AdminBlockItem } from "@/lib/positions/data";

const DAY_TYPES: { dayType: DayType; label: string }[] = [
  { dayType: "weekday", label: "Weekdays" },
  { dayType: "weekend", label: "Weekends" },
];

/**
 * Per-position block editor (roadmap 3.3): two columns (weekdays/weekends) of
 * HH:MM time rows with add/remove, live derived Open/Close tags, and live
 * block-set warnings. Times are edited as time-input strings and converted to
 * minutes at the seam; unparseable edits fall back to the saved value for the
 * live derivation.
 */
export function BlockEditor({ position, blocks }: { position: Position; blocks: AdminBlockItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Unsaved time edits by block id. Kept after save; dirtiness is computed
  // against the saved minutes, so a refresh settles it back to clean.
  const [edits, setEdits] = useState<Record<string, { start: string; end: string }>>({});
  const [adds, setAdds] = useState<Record<DayType, { start: string; end: string }>>({
    weekday: { start: "", end: "" },
    weekend: { start: "", end: "" },
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const valueOf = (b: AdminBlockItem) =>
    edits[b.id] ?? { start: minutesToHHMM(b.start), end: minutesToHHMM(b.end) };

  // The live view the Open/Close tags and warnings derive from.
  const liveBlocks: ShiftBlock[] = blocks.map((b) => {
    const v = valueOf(b);
    return {
      id: b.id,
      positionId: b.positionId,
      dayType: b.dayType,
      start: hhmmToMinutes(v.start) ?? b.start,
      end: hhmmToMinutes(v.end) ?? b.end,
    };
  });
  const openClose = Object.fromEntries(
    DAY_TYPES.map(({ dayType }) => [
      dayType,
      deriveOpenClose(liveBlocks.filter((b) => b.dayType === dayType)),
    ]),
  );
  const warnings = blockSetWarnings(position, liveBlocks);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? okText : (res.error ?? "Failed.") });
      if (res.ok) router.refresh();
    });
  }

  /** Parse an edited pair, or surface why it can't be saved. */
  function parsePair(start: string, end: string): { start: number; end: number } | null {
    const s = hhmmToMinutes(start);
    const e = hhmmToMinutes(end);
    if (s === null || e === null) {
      setMsg({ ok: false, text: "Enter both a start and an end time." });
      return null;
    }
    const error = validateBlockTimes(s, e);
    if (error) {
      setMsg({ ok: false, text: error });
      return null;
    }
    return { start: s, end: e };
  }

  function saveBlock(b: AdminBlockItem) {
    const v = valueOf(b);
    const parsed = parsePair(v.start, v.end);
    if (!parsed) return;
    if (
      b.selectionCount > 0 &&
      !confirm(
        `${b.selectionCount} student${b.selectionCount === 1 ? " has" : "s have"} picked this shift. Change its time?`,
      )
    ) {
      return;
    }
    act(() => updateBlock(b.id, parsed.start, parsed.end), "Times saved.");
  }

  function removeBlock(b: AdminBlockItem) {
    if (!confirm("Remove this block?")) return;
    act(() => deleteBlock(b.id), "Block removed.");
  }

  function addBlock(dayType: DayType) {
    const v = adds[dayType];
    const parsed = parsePair(v.start, v.end);
    if (!parsed) return;
    setMsg(null);
    startTransition(async () => {
      const res = await createBlock(position.id, dayType, parsed.start, parsed.end);
      if (res.ok) {
        setAdds((prev) => ({ ...prev, [dayType]: { start: "", end: "" } }));
        setMsg({ ok: true, text: "Block added." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed." });
      }
    });
  }

  return (
    <div>
      <div style={columns}>
        {DAY_TYPES.map(({ dayType, label }) => {
          const dayBlocks = blocks.filter((b) => b.dayType === dayType);
          const oc = openClose[dayType]!;
          return (
            <div key={dayType}>
              <h3 style={h3}>{label}</h3>
              {dayBlocks.length === 0 && (
                <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  No blocks yet.
                </p>
              )}
              {dayBlocks.map((b) => {
                const v = valueOf(b);
                const saved = { start: minutesToHHMM(b.start), end: minutesToHHMM(b.end) };
                const dirty = v.start !== saved.start || v.end !== saved.end;
                return (
                  <div key={b.id} style={row}>
                    <input
                      type="time"
                      value={v.start}
                      disabled={pending}
                      onChange={(e) =>
                        setEdits((prev) => ({ ...prev, [b.id]: { ...v, start: e.target.value } }))
                      }
                      style={timeInput}
                    />
                    <span style={{ fontSize: 13 }}>to</span>
                    <input
                      type="time"
                      value={v.end}
                      disabled={pending}
                      onChange={(e) =>
                        setEdits((prev) => ({ ...prev, [b.id]: { ...v, end: e.target.value } }))
                      }
                      style={timeInput}
                    />
                    {oc.openId === b.id && <span style={openTag}>Open</span>}
                    {oc.closeId === b.id && <span style={closeTag}>Close</span>}
                    {b.selectionCount > 0 && (
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {b.selectionCount} pick{b.selectionCount === 1 ? "" : "s"}
                      </span>
                    )}
                    <button type="button" disabled={pending || !dirty} onClick={() => saveBlock(b)}>
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={pending || b.selectionCount > 0}
                      title={
                        b.selectionCount > 0
                          ? `${b.selectionCount} student pick${b.selectionCount === 1 ? "" : "s"} reference this block`
                          : undefined
                      }
                      style={{ color: "var(--color-text-danger)" }}
                      onClick={() => removeBlock(b)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div style={row}>
                <input
                  type="time"
                  value={adds[dayType].start}
                  disabled={pending}
                  onChange={(e) =>
                    setAdds((prev) => ({
                      ...prev,
                      [dayType]: { ...prev[dayType], start: e.target.value },
                    }))
                  }
                  style={timeInput}
                />
                <span style={{ fontSize: 13 }}>to</span>
                <input
                  type="time"
                  value={adds[dayType].end}
                  disabled={pending}
                  onChange={(e) =>
                    setAdds((prev) => ({
                      ...prev,
                      [dayType]: { ...prev[dayType], end: e.target.value },
                    }))
                  }
                  style={timeInput}
                />
                <button
                  type="button"
                  disabled={pending || !adds[dayType].start || !adds[dayType].end}
                  onClick={() => addBlock(dayType)}
                >
                  Add block
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {msg && (
        <p
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
      {warnings.map((w) => (
        <InfoCard key={w.kind} tone="danger" style={{ margin: "10px 0 0", padding: "0.6rem 1.2rem" }}>
          <p style={{ margin: 0, fontSize: 14 }}>{w.message}</p>
        </InfoCard>
      ))}
    </div>
  );
}

const columns: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "12px 24px",
};
const h3: React.CSSProperties = { fontSize: 14, margin: "0 0 8px" };
const row: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: 8,
};
const timeInput: React.CSSProperties = {
  padding: 4,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
};
const tagBase: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
  whiteSpace: "nowrap",
};
const openTag: React.CSSProperties = { ...tagBase, background: "#e6f4ea", color: "#196127" };
const closeTag: React.CSSProperties = { ...tagBase, background: "#e7f0fb", color: "#1a66cc" };
