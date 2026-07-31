"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InfoCard } from "@/components/ui";
import { deriveOpenClose } from "@/lib/domain/blocks";
import {
  DESIRED_CAPACITY_MAX,
  blockSetWarnings,
  positionCapacityCheck,
  seatHoursPerWeek,
  validateBlockTimes,
  validateDesiredCapacity,
} from "@/lib/domain/config-validation";
import { hhmmToMinutes, minutesToHHMM } from "@/lib/domain/time";
import type { DayType, Position, ShiftBlock } from "@/lib/domain/types";
import { createBlock, deleteBlock } from "@/lib/positions/actions";
import type { AdminBlockItem } from "@/lib/positions/data";

const DAY_TYPES: { dayType: DayType; label: string }[] = [
  { dayType: "weekday", label: "Weekdays" },
  { dayType: "weekend", label: "Weekends" },
];

/**
 * One block row's unsaved values: times as HH:MM strings, target staffing as a
 * number-input string ("" = no target).
 */
export interface BlockRowEdit {
  start: string;
  end: string;
  cap: string;
}

/** The saved row values in input-string form (what dirtiness is measured against). */
export function savedBlockRow(b: AdminBlockItem): BlockRowEdit {
  return {
    start: minutesToHHMM(b.start),
    end: minutesToHHMM(b.end),
    cap: b.desiredCapacity === null ? "" : String(b.desiredCapacity),
  };
}

export function blockRowDirty(b: AdminBlockItem, edit: BlockRowEdit | undefined): boolean {
  if (!edit) return false;
  const saved = savedBlockRow(b);
  return edit.start !== saved.start || edit.end !== saved.end || edit.cap !== saved.cap;
}

/** Parse one row's strings into save-ready values, or say why they can't be saved. */
export function parseBlockRow(
  v: BlockRowEdit,
):
  | { ok: true; start: number; end: number; desiredCapacity: number | null }
  | { ok: false; error: string } {
  const start = hhmmToMinutes(v.start);
  const end = hhmmToMinutes(v.end);
  if (start === null || end === null) {
    return { ok: false, error: "Enter both a start and an end time." };
  }
  const timeError = validateBlockTimes(start, end);
  if (timeError) return { ok: false, error: timeError };
  const trimmed = v.cap.trim();
  const desiredCapacity = trimmed === "" ? null : Number(trimmed);
  const capacityError = validateDesiredCapacity(desiredCapacity);
  if (capacityError) return { ok: false, error: capacityError };
  return { ok: true, start, end, desiredCapacity };
}

/**
 * Per-position block editor (roadmap 3.3): two columns (weekdays/weekends) of
 * HH:MM time rows with add/remove, live derived Open/Close tags, live
 * block-set warnings, and the weekly capacity check against the roster. Times
 * are edited as time-input strings and converted to minutes at the seam;
 * unparseable edits fall back to the saved value for the live derivation.
 * Row edits live in the parent card, whose single Save writes them; add and
 * remove stay immediate here.
 */
export function BlockEditor({
  position,
  blocks,
  onRosterCount,
  edits,
  onEdit,
  saving,
}: {
  position: Position;
  blocks: AdminBlockItem[];
  /** On-roster students holding this position (the capacity check's demand side). */
  onRosterCount: number;
  /** Unsaved row edits, keyed by block id and owned by the card. */
  edits: Record<string, BlockRowEdit>;
  onEdit: (blockId: string, value: BlockRowEdit) => void;
  /** True while the card's Save is in flight. */
  saving: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adds, setAdds] = useState<Record<DayType, BlockRowEdit>>({
    weekday: { start: "", end: "", cap: "" },
    weekend: { start: "", end: "", cap: "" },
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = pending || saving;

  const valueOf = (b: AdminBlockItem) => edits[b.id] ?? savedBlockRow(b);

  // The live view the Open/Close tags, warnings, and capacity check derive from.
  const liveBlocks: ShiftBlock[] = blocks.map((b) => {
    const v = valueOf(b);
    const cap = v.cap.trim() === "" ? null : Number(v.cap);
    return {
      id: b.id,
      positionId: b.positionId,
      dayType: b.dayType,
      start: hhmmToMinutes(v.start) ?? b.start,
      end: hhmmToMinutes(v.end) ?? b.end,
      desiredCapacity: cap === null || Number.isFinite(cap) ? cap : b.desiredCapacity,
    };
  });
  const openClose = Object.fromEntries(
    DAY_TYPES.map(({ dayType }) => [
      dayType,
      deriveOpenClose(liveBlocks.filter((b) => b.dayType === dayType)),
    ]),
  );
  const warnings = blockSetWarnings(position, liveBlocks);
  const capacity = positionCapacityCheck(liveBlocks, onRosterCount, position.minHours);
  // Supply side alone (no roster needed): what this position can seat each week.
  const seatHours = seatHoursPerWeek(liveBlocks);

  function removeBlock(b: AdminBlockItem) {
    if (!confirm("Remove this block?")) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteBlock(b.id);
      setMsg({ ok: res.ok, text: res.ok ? "Block removed." : (res.error ?? "Failed.") });
      if (res.ok) router.refresh();
    });
  }

  function addBlock(dayType: DayType) {
    const parsed = parseBlockRow(adds[dayType]);
    if (!parsed.ok) {
      setMsg({ ok: false, text: parsed.error });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await createBlock(
        position.id,
        dayType,
        parsed.start,
        parsed.end,
        parsed.desiredCapacity,
      );
      if (res.ok) {
        setAdds((prev) => ({ ...prev, [dayType]: { start: "", end: "", cap: "" } }));
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
                <p
                  style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}
                >
                  No blocks yet.
                </p>
              )}
              {dayBlocks.map((b) => {
                const v = valueOf(b);
                return (
                  <div key={b.id} style={row}>
                    <input
                      type="time"
                      value={v.start}
                      disabled={busy}
                      onChange={(e) => onEdit(b.id, { ...v, start: e.target.value })}
                      style={timeInput}
                    />
                    <span style={{ fontSize: 13 }}>to</span>
                    <input
                      type="time"
                      value={v.end}
                      disabled={busy}
                      onChange={(e) => onEdit(b.id, { ...v, end: e.target.value })}
                      style={timeInput}
                    />
                    <input
                      type="number"
                      min={1}
                      max={DESIRED_CAPACITY_MAX}
                      value={v.cap}
                      disabled={busy}
                      aria-label="Target staffing"
                      title="How many students this shift needs each day. Leave blank for no target."
                      onChange={(e) => onEdit(b.id, { ...v, cap: e.target.value })}
                      style={capInput}
                    />
                    <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      staff
                    </span>
                    {oc.openId === b.id && <span style={openTag}>Open</span>}
                    {oc.closeId === b.id && <span style={closeTag}>Close</span>}
                    {b.realPickCount > 0 && (
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {b.realPickCount} pick{b.realPickCount === 1 ? "" : "s"}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy || b.selectionCount > 0}
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
                  disabled={busy}
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
                  disabled={busy}
                  onChange={(e) =>
                    setAdds((prev) => ({
                      ...prev,
                      [dayType]: { ...prev[dayType], end: e.target.value },
                    }))
                  }
                  style={timeInput}
                />
                <input
                  type="number"
                  min={1}
                  max={DESIRED_CAPACITY_MAX}
                  value={adds[dayType].cap}
                  disabled={busy}
                  aria-label="Target staffing"
                  title="How many students this shift needs each day. Leave blank for no target."
                  onChange={(e) =>
                    setAdds((prev) => ({
                      ...prev,
                      [dayType]: { ...prev[dayType], cap: e.target.value },
                    }))
                  }
                  style={capInput}
                />
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>staff</span>
                <button
                  type="button"
                  disabled={busy || !adds[dayType].start || !adds[dayType].end}
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
        <InfoCard
          key={w.kind}
          tone="danger"
          style={{ margin: "10px 0 0", padding: "0.6rem 1.2rem" }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>{w.message}</p>
        </InfoCard>
      ))}
      {/* Seat hours, once any block has a target. A shortfall against the roster
          reads as a warning (and already names the seat hours); otherwise the
          total shows as a plain line, roster or not. */}
      {seatHours > 0 &&
        (onRosterCount > 0 && capacity.kind === "short" ? (
          <InfoCard tone="warning" style={{ margin: "10px 0 0", padding: "0.6rem 1.2rem" }}>
            <p style={{ margin: 0, fontSize: 14 }}>{capacity.message}</p>
          </InfoCard>
        ) : (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
            Shift targets add up to about {Math.round(seatHours)} seat hours a week.
          </p>
        ))}
      {onRosterCount > 0 && blocks.length > 0 && capacity.kind === "no_targets" && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
          Set staffing targets to check weekly capacity against the roster.
        </p>
      )}
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
const capInput: React.CSSProperties = { ...timeInput, width: 56 };
const tagBase: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
  whiteSpace: "nowrap",
};
const openTag: React.CSSProperties = { ...tagBase, background: "#e6f4ea", color: "#196127" };
const closeTag: React.CSSProperties = { ...tagBase, background: "#e7f0fb", color: "#1a66cc" };
