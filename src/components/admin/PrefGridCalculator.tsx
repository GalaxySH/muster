"use client";

import { useMemo, useState } from "react";
import type { AdminGridModel, AdminSubGrid } from "@/lib/admin/summary";
import { computeCapacity } from "@/lib/domain/capacity";
import { keysToSelection, selectionKey } from "@/lib/availability/selection";
import { DAY_LABEL, type Day, type ShiftBlock } from "@/lib/domain/types";

/**
 * Interactive preference grid + live hours calculator for the per-student admin
 * view. The admin clicks cells to mock a schedule; the corner readout shows the
 * hours that mock would come to, computed exactly like preference capacity
 * (`computeCapacity`, cycle-averaged). Opens on the student's own picks, so the
 * readout starts at their preference capacity and the admin edits from there.
 *
 * The persisted overlay ("on" = student pick, "auto" = machine-assigned) is kept
 * as a reference layer so, as the admin trims cells, they still see what the
 * student actually offered.
 */

// Compact fixed cell size; keeps the grid tight instead of stretching wide.
const CELL = 26;

const fmtHours = (h: number) => `${Math.round(h * 10) / 10}h`;

export interface PrefGridCalculatorProps {
  grid: AdminGridModel;
  /** All of the position's blocks, for the live hours calculation. */
  blocks: ShiftBlock[];
  /** The student's weekend rotation: drives the badge and the weekend ×0.5 factor. */
  everyWeekendOptIn: boolean;
  /** Position hours floor, for the below-floor cue. */
  minHours: number;
  /** Weekly hours cap (scheduler-side context), for the over-cap cue. */
  cap: number;
}

/** Pull the student's picks ("on") and auto-assigned ("auto") cells out of the overlay. */
function referenceKeys(grid: AdminGridModel): { preferred: Set<string>; auto: Set<string> } {
  const preferred = new Set<string>();
  const auto = new Set<string>();
  for (const sub of [grid.weekday, grid.weekend]) {
    if (!sub) continue;
    for (const row of sub.rows) {
      row.cells.forEach((state, i) => {
        const key = selectionKey(row.block.id, sub.days[i]!);
        if (state === "on") preferred.add(key);
        else if (state === "auto") auto.add(key);
      });
    }
  }
  return { preferred, auto };
}

export function PrefGridCalculator(props: PrefGridCalculatorProps) {
  const { preferred, auto } = useMemo(() => referenceKeys(props.grid), [props.grid]);
  const [mock, setMock] = useState<Set<string>>(() => new Set(preferred));
  // The rotation is part of the trial too: flipping the pill re-weights the
  // weekend (x0.5 under A/B, x1.0 every-weekend) without touching the student's
  // real answer.
  const [optIn, setOptIn] = useState(props.everyWeekendOptIn);

  // Guard against any stray key referencing an unknown block (computeCapacity throws).
  const validIds = useMemo(() => new Set(props.blocks.map((b) => b.id)), [props.blocks]);
  const selection = useMemo(
    () => keysToSelection(mock).filter((s) => validIds.has(s.blockId)),
    [mock, validIds],
  );

  const capacity = useMemo(
    () => computeCapacity(selection, props.blocks, { everyWeekendOptIn: optIn }),
    [selection, props.blocks, optIn],
  );
  const hours = capacity.weeklyAverageHours;
  const dayCount = useMemo(() => new Set(selection.map((s) => s.day)).size, [selection]);

  const belowFloor = mock.size > 0 && hours < props.minHours;
  const overCap = hours > props.cap;
  const dirty =
    optIn !== props.everyWeekendOptIn ||
    mock.size !== preferred.size ||
    [...mock].some((k) => !preferred.has(k));

  function reset() {
    setMock(new Set(preferred));
    setOptIn(props.everyWeekendOptIn);
  }

  function toggle(blockId: string, day: Day) {
    setMock((prev) => {
      const next = new Set(prev);
      const key = selectionKey(blockId, day);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const statusText = overCap
    ? `over ${props.cap}h cap`
    : belowFloor
      ? `below ${props.minHours}h floor`
      : mock.size === 0
        ? "no shifts picked"
        : "trial schedule";
  const accent = overCap
    ? "var(--color-text-danger)"
    : belowFloor
      ? "var(--color-text-warning)"
      : "var(--color-text-info)";

  return (
    <>
      {/* Header: section label on the left, live hours badge in the upper corner. */}
      <div style={headerRow}>
        <div style={sectionLabel}>Availability preferences</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
            {dirty && (
              <button
                type="button"
                onClick={reset}
                style={miniBtn}
                title="Reset to the student's picks"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => setMock(new Set())}
              style={miniBtn}
              title="Clear every cell"
            >
              Clear
            </button>
          </div>
          <div style={badge} aria-live="polite">
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: accent }}>
              {fmtHours(hours)}
            </div>
            <div
              style={{
                fontSize: 11,
                marginTop: 2,
                color: belowFloor || overCap ? accent : "var(--color-text-secondary)",
              }}
            >
              {statusText}
              {mock.size > 0 && !belowFloor && !overCap && (
                <span style={{ color: "var(--color-text-tertiary)" }}>
                  {" "}
                  · {dayCount} day{dayCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <SubHead>Weekday</SubHead>
          <CalcTable sub={props.grid.weekday} mock={mock} preferred={preferred} auto={auto} onToggle={toggle} />
        </div>
        {props.grid.weekend && (
          <div>
            <SubHead>
              Weekend
              <button
                type="button"
                aria-pressed={optIn}
                onClick={() => setOptIn((v) => !v)}
                style={weekendModeBadge(optIn)}
                title={
                  optIn
                    ? "Every weekend. Click to try alternating (A/B)."
                    : "Alternating (A/B). Click to try every weekend."
                }
              >
                {optIn ? "EVERY weekend" : "alternating (A/B)"}
              </button>
            </SubHead>
            <CalcTable sub={props.grid.weekend} mock={mock} preferred={preferred} auto={auto} onToggle={toggle} />
          </div>
        )}
      </div>

      <Legend />
    </>
  );
}

function CalcTable({
  sub,
  mock,
  preferred,
  auto,
  onToggle,
}: {
  sub: AdminSubGrid;
  mock: Set<string>;
  preferred: Set<string>;
  auto: Set<string>;
  onToggle: (blockId: string, day: Day) => void;
}) {
  return (
    <table style={{ width: "auto", borderCollapse: "separate", borderSpacing: 3, fontSize: 11 }}>
      <tbody>
        <tr style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>
          <td />
          {sub.days.map((d) => (
            <td key={d} style={{ width: CELL, textAlign: "center" }}>
              {DAY_LABEL[d]}
            </td>
          ))}
        </tr>
        {sub.rows.map((row) => (
          <tr key={row.block.id}>
            <td style={{ whiteSpace: "nowrap" }}>
              {row.label}{" "}
              {row.isOpen && <span style={{ color: "var(--color-text-info)" }}>open</span>}
              {row.isClose && <span style={{ color: "var(--color-text-info)" }}>close</span>}
            </td>
            {sub.days.map((day, i) => {
              const key = selectionKey(row.block.id, day);
              const inMock = mock.has(key);
              const wasPreferred = preferred.has(key);
              const wasAuto = auto.has(key);
              const isHot = row.highDemandDays[i] ?? false;
              return (
                <td key={day} style={{ padding: 0 }}>
                  <button
                    type="button"
                    aria-pressed={inMock}
                    aria-label={`${row.label} ${DAY_LABEL[day]}`}
                    title={cellTitle(inMock, wasPreferred, wasAuto, isHot)}
                    onClick={() => onToggle(row.block.id, day)}
                    style={cellStyle(inMock, wasPreferred, wasAuto)}
                  >
                    {isHot && <span aria-hidden style={hotTick} />}
                    {inMock ? (
                      <span style={{ fontSize: 12 }}>✓</span>
                    ) : wasAuto ? (
                      <span style={{ fontSize: 9 }}>auto</span>
                    ) : null}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellTitle(inMock: boolean, wasPreferred: boolean, wasAuto: boolean, isHot: boolean): string {
  const parts: string[] = [];
  if (inMock)
    parts.push(
      wasPreferred || wasAuto
        ? "In trial schedule"
        : "In trial schedule (not one the student picked)",
    );
  else if (wasPreferred) parts.push("Student picked this; not in the trial schedule");
  else if (wasAuto) parts.push("Auto-assigned; not in the trial schedule");
  else parts.push("Click to add to the trial schedule");
  if (isHot) parts.push("a lot of students picked this shift");
  return parts.join(" · ");
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Legend() {
  return (
    <div style={legendRow}>
      <span>
        <span style={{ ...swatch, background: "var(--color-text-info)" }} /> in trial schedule
      </span>
      <span>
        <span
          style={{ ...swatch, background: "var(--color-background-info)", border: "1px solid var(--color-text-info)" }}
        />{" "}
        picked, not in trial
      </span>
      <span>
        <span
          style={{
            ...swatch,
            background: "var(--color-background-warning)",
            border: "1px dashed var(--color-border-warning)",
          }}
        />{" "}
        auto-assigned
      </span>
      <span>
        <span
          style={{ display: "inline-block", width: 3, height: 11, background: "var(--color-text-danger)", verticalAlign: -1 }}
        />{" "}
        high-demand
      </span>
    </div>
  );
}

// --- styles ---

const headerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 12,
};
const sectionLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--color-text-primary)",
};
const badge: React.CSSProperties = {
  textAlign: "right",
  minWidth: 96,
};
const miniBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: "var(--border-radius-md)",
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
const hotTick: React.CSSProperties = {
  position: "absolute",
  top: 1,
  right: 1,
  width: 3,
  height: 7,
  background: "var(--color-text-danger)",
  borderRadius: 1,
  pointerEvents: "none",
};
const legendRow: React.CSSProperties = {
  display: "flex",
  gap: 14,
  flexWrap: "wrap",
  marginTop: 12,
  fontSize: 11,
  color: "var(--color-text-secondary)",
};
const swatch: React.CSSProperties = {
  display: "inline-block",
  width: 11,
  height: 11,
  borderRadius: 3,
  verticalAlign: -1,
};

/**
 * The weekend rotation, made unmissable: opt-ins get a filled badge, A/B a quiet
 * one. It's also the toggle that re-weights the weekend in the trial, so it
 * carries button affordances.
 */
const weekendModeBadge = (every: boolean): React.CSSProperties => ({
  display: "inline-block",
  marginLeft: 8,
  padding: "1px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "inherit",
  lineHeight: 1.6,
  cursor: "pointer",
  ...(every
    ? { background: "var(--color-text-info)", color: "#fff", border: "1px solid var(--color-text-info)" }
    : {
        background: "var(--color-background-secondary)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border-tertiary)",
      }),
});

function cellStyle(inMock: boolean, wasPreferred: boolean, wasAuto: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "relative",
    width: CELL,
    height: 22,
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
    fontWeight: 700,
    cursor: "pointer",
  };
  if (inMock) {
    return {
      ...base,
      background: "var(--color-text-info)",
      color: "#fff",
      // A cell the student never offered, now in the trial, gets an amber ring.
      border:
        wasPreferred || wasAuto
          ? "1px solid var(--color-text-info)"
          : "1.5px dashed var(--color-border-warning)",
    };
  }
  if (wasPreferred) {
    return {
      ...base,
      background: "var(--color-background-info)",
      border: "1px solid var(--color-text-info)",
      color: "var(--color-text-info)",
    };
  }
  if (wasAuto) {
    return {
      ...base,
      background: "var(--color-background-warning)",
      border: "1.5px dashed var(--color-border-warning)",
      color: "var(--color-text-warning)",
    };
  }
  return {
    ...base,
    background: "var(--color-background-secondary)",
    border: "1px solid var(--color-border-tertiary)",
    color: "transparent",
  };
}
