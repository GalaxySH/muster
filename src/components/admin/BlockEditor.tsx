"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionMessage, Button, Notice, Pill, VisuallyHidden } from "@/components/admin/ui";
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
import { createBlock, deleteBlock, restoreBlock } from "@/lib/positions/actions";
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
 * What a position's blocks add up to with the unsaved edits applied: the live
 * block set, its warnings, and the weekly capacity check against the roster.
 * The editor shows them, and the card counts them for its closed summary.
 *
 * Retired shifts are config history, not config: they are excluded from the
 * derived open/close, the warnings, and the capacity check, exactly as every
 * other read excludes them. They only render so the admin can put one back.
 */
export function blockChecks(
  position: Position,
  allBlocks: AdminBlockItem[],
  edits: Record<string, BlockRowEdit>,
  onRosterCount: number,
  dayCapHours: number,
) {
  // The live view the Open/Close tags, warnings, and capacity check derive from.
  const liveBlocks: ShiftBlock[] = allBlocks
    .filter((b) => !b.retired)
    .map((b) => {
      const v = edits[b.id] ?? savedBlockRow(b);
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
  const capacity = positionCapacityCheck(liveBlocks, onRosterCount, position.minHours);
  // Supply side alone (no roster needed): what this position can seat each week.
  const seatHours = seatHoursPerWeek(liveBlocks);
  return {
    liveBlocks,
    warnings: blockSetWarnings(position, liveBlocks, dayCapHours),
    capacity,
    seatHours,
    /** The capacity check is shown as a warning: targets are set and fall short of the roster. */
    capacityShort: seatHours > 0 && onRosterCount > 0 && capacity.kind === "short",
  };
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
  blocks: allBlocks,
  onRosterCount,
  dayCapHours,
  edits,
  onEdit,
  saving,
}: {
  position: Position;
  blocks: AdminBlockItem[];
  /** On-roster students holding this position (the capacity check's demand side). */
  onRosterCount: number;
  /** The schedule engine's max merged hours per day, for the over-cap warning. */
  dayCapHours: number;
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

  const blocks = allBlocks.filter((b) => !b.retired);
  const retiredBlocks = allBlocks.filter((b) => b.retired);
  const { liveBlocks, warnings, capacity, seatHours } = blockChecks(
    position,
    allBlocks,
    edits,
    onRosterCount,
    dayCapHours,
  );
  const openClose = Object.fromEntries(
    DAY_TYPES.map(({ dayType }) => [
      dayType,
      deriveOpenClose(liveBlocks.filter((b) => b.dayType === dayType)),
    ]),
  );

  function removeBlock(b: AdminBlockItem) {
    const picks = b.realPickCount;
    const warning =
      b.selectionCount > 0
        ? `${picks > 0 ? `${picks} student${picks === 1 ? " has" : "s have"} picked this shift. ` : ""}Removing it takes it off their availability and out of scheduling. Their picks stay on their response for you to clear. Remove it?`
        : "Remove this shift?";
    if (!confirm(warning)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteBlock(b.id);
      setMsg({
        ok: res.ok,
        text: res.ok
          ? res.retired
            ? `Shift removed. ${res.orphaned} response${res.orphaned === 1 ? "" : "s"} now ${res.orphaned === 1 ? "has" : "have"} a pick to clear.`
            : "Shift removed."
          : (res.error ?? "Failed."),
      });
      if (res.ok) router.refresh();
    });
  }

  function putBackBlock(b: AdminBlockItem) {
    setMsg(null);
    startTransition(async () => {
      const res = await restoreBlock(b.id);
      setMsg({ ok: res.ok, text: res.ok ? "Shift put back." : (res.error ?? "Failed.") });
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

  const setAdd = (dayType: DayType, patch: Partial<BlockRowEdit>) =>
    setAdds((prev) => ({ ...prev, [dayType]: { ...prev[dayType], ...patch } }));

  return (
    <div className="ad-stack">
      <div className="ad-cols">
        {DAY_TYPES.map(({ dayType, label }) => {
          const dayBlocks = blocks.filter((b) => b.dayType === dayType);
          const oc = openClose[dayType]!;
          const add = adds[dayType];
          return (
            <div key={dayType}>
              <h3>{label}</h3>
              {dayBlocks.length === 0 && <p className="ad-muted">No blocks yet.</p>}
              <table className="ad-table ad-table--stack ad-table--middle ad-table--plain">
                <thead>
                  <tr>
                    <th scope="col">Start</th>
                    <th scope="col">End</th>
                    <th scope="col">Staff</th>
                    <th scope="col">
                      <VisuallyHidden>Tags and picks</VisuallyHidden>
                    </th>
                    <th scope="col">
                      <VisuallyHidden>Actions</VisuallyHidden>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dayBlocks.map((b) => {
                    const v = valueOf(b);
                    return (
                      <tr key={b.id}>
                        <td data-label="Start">
                          <input
                            type="time"
                            value={v.start}
                            disabled={busy}
                            aria-label="Start"
                            onChange={(e) => onEdit(b.id, { ...v, start: e.target.value })}
                          />
                        </td>
                        <td data-label="End">
                          <input
                            type="time"
                            value={v.end}
                            disabled={busy}
                            aria-label="End"
                            onChange={(e) => onEdit(b.id, { ...v, end: e.target.value })}
                          />
                        </td>
                        <td data-label="Staff">
                          <input
                            type="number"
                            className="ad-su-blocks-cap"
                            min={1}
                            max={DESIRED_CAPACITY_MAX}
                            value={v.cap}
                            disabled={busy}
                            aria-label="Target staffing"
                            title="How many students this shift needs each day. Leave blank for no target."
                            onChange={(e) => onEdit(b.id, { ...v, cap: e.target.value })}
                          />
                        </td>
                        <td>
                          <span className="ad-su-tags">
                            {oc.openId === b.id && <Pill tone="success">Open</Pill>}
                            {oc.closeId === b.id && <Pill tone="info">Close</Pill>}
                            {b.realPickCount > 0 && (
                              <span className="ad-muted ad-small">
                                {b.realPickCount} pick{b.realPickCount === 1 ? "" : "s"}
                              </span>
                            )}
                          </span>
                        </td>
                        <td>
                          <Button
                            variant="danger"
                            disabled={busy}
                            title={
                              b.selectionCount > 0
                                ? "Take this shift out of scheduling. Picks already on it stay on each response for you to clear."
                                : "Remove this shift."
                            }
                            onClick={() => removeBlock(b)}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td data-label="Start">
                      <input
                        type="time"
                        value={add.start}
                        disabled={busy}
                        aria-label="New block start"
                        onChange={(e) => setAdd(dayType, { start: e.target.value })}
                      />
                    </td>
                    <td data-label="End">
                      <input
                        type="time"
                        value={add.end}
                        disabled={busy}
                        aria-label="New block end"
                        onChange={(e) => setAdd(dayType, { end: e.target.value })}
                      />
                    </td>
                    <td data-label="Staff">
                      <input
                        type="number"
                        className="ad-su-blocks-cap"
                        min={1}
                        max={DESIRED_CAPACITY_MAX}
                        value={add.cap}
                        disabled={busy}
                        aria-label="Target staffing"
                        title="How many students this shift needs each day. Leave blank for no target."
                        onChange={(e) => setAdd(dayType, { cap: e.target.value })}
                      />
                    </td>
                    <td />
                    <td>
                      <Button
                        disabled={busy || !add.start || !add.end}
                        onClick={() => addBlock(dayType)}
                      >
                        Add block
                      </Button>
                    </td>
                  </tr>

                  {/* Removed shifts students had already picked. Kept visible so the
                      admin can undo a removal; putting one back makes those picks
                      count again. */}
                  {retiredBlocks
                    .filter((b) => b.dayType === dayType)
                    .map((b) => (
                      <tr key={b.id}>
                        <td colSpan={3}>
                          <span className="ad-struck">
                            {minutesToHHMM(b.start)} to {minutesToHHMM(b.end)}
                          </span>
                        </td>
                        <td>
                          <span className="ad-su-tags">
                            <Pill tone="danger">removed</Pill>
                            {b.realPickCount > 0 && (
                              <span className="ad-muted ad-small">
                                {b.realPickCount} pick{b.realPickCount === 1 ? "" : "s"} left to
                                clear
                              </span>
                            )}
                          </span>
                        </td>
                        <td>
                          <Button
                            disabled={busy}
                            title="Put this shift back. Picks still on it count again."
                            onClick={() => putBackBlock(b)}
                          >
                            Put back
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      {msg && (
        <ActionMessage ok={msg.ok} as="p">
          {msg.text}
        </ActionMessage>
      )}
      {warnings.map((w) => (
        <Notice key={w.kind} tone="danger">
          <p>{w.message}</p>
        </Notice>
      ))}
      {/* Seat hours, once any block has a target. A shortfall against the roster
          reads as a warning (and already names the seat hours); otherwise the
          total shows as a plain line, roster or not. */}
      {seatHours > 0 &&
        (onRosterCount > 0 && capacity.kind === "short" ? (
          <Notice tone="warning">
            <p>{capacity.message}</p>
          </Notice>
        ) : (
          <p className="ad-help">
            Shift targets add up to about {Math.round(seatHours)} seat hours a week.
          </p>
        ))}
      {onRosterCount > 0 && blocks.length > 0 && capacity.kind === "no_targets" && (
        <p className="ad-help">Set staffing targets to check weekly capacity against the roster.</p>
      )}
    </div>
  );
}
