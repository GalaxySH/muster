"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminGridModel, AdminSubGrid } from "@/lib/admin/summary";
import { computeCapacity } from "@/lib/domain/capacity";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { keysToSelection, selectionKey } from "@/lib/availability/selection";
import { saveAvailabilityFor } from "@/lib/availability/actions";
import { removeManualAssignment, setManualAssignment } from "@/lib/schedule/manual";
import type { AssignmentSource } from "@/lib/domain/scheduling/types";
import { formatTime } from "@/lib/domain/time";
import {
  DAY_LABEL,
  dayTypeOf,
  type Day,
  type Position,
  type SelectedShift,
  type ShiftBlock,
} from "@/lib/domain/types";

/**
 * Interactive grid + live hours calculator for the per-student admin view.
 * Every cell is split diagonally: the lower-left half is the student's
 * availability preference, the upper-right half is the current schedule run's
 * assignment for that (block, day). Preferences and assignments live in
 * separate tables (generation never overwrites preferences); the split makes
 * that visible, including a scheduled shift the student never offered.
 *
 * Two edit modes. **Edit preferences** is the existing what-if calculator: the
 * admin clicks cells to try a schedule, the corner readout shows the trial's
 * cycle-averaged hours (`computeCapacity`), and Save writes the selection and
 * rotation on the student's behalf. Hard-rule failures warn instead of
 * blocking here: Save lists the failing checks and offers "Save anyway", which
 * persists and raises the revalidation_failed flag through the same seam a
 * position change uses (a later clean save clears it). Only this admin surface
 * gets the override; the student form keeps refusing.
 *
 * **Edit schedule** toggles the current run's rows per cell through the manual
 * assignment actions (source "manual"; removing an engine row is allowed).
 * Disabled until a run exists.
 */

// Compact fixed cell size; keeps the grid tight instead of stretching wide.
const CELL = 26;

/** Schedule-half fills: engine rows green, manual rows violet. */
const ENGINE_COLOR = "#2e9e5b";
const MANUAL_COLOR = "#8a4fd3";
/** The empty half of a cell; matches the untouched-preference fill. */
const EMPTY_COLOR = "var(--color-background-secondary)";
/**
 * "Picked, but not in the trial schedule": a mid blue that reads clearly against
 * the grid, where the old near-white tint was almost invisible. Still plainly
 * lighter than the strong trial-blue fill, which also carries a check mark.
 */
const PREF_PICKED_COLOR = "#8cb2e5";

const fmtNum = (h: number) => `${Math.round(h * 10) / 10}`;
const fmtHours = (h: number) => `${fmtNum(h)}h`;

/** e.g. "Sat 8:30a–11a", for the auto-weekend tooltip. */
function describeCell(cell: SelectedShift, blocks: readonly ShiftBlock[]): string {
  const block = blocks.find((b) => b.id === cell.blockId);
  if (!block) return DAY_LABEL[cell.day];
  return `${DAY_LABEL[cell.day]} ${formatTime(block.start)}–${formatTime(block.end)}`;
}

type Mode = "prefs" | "schedule";

export interface PrefGridCalculatorProps {
  grid: AdminGridModel;
  /** Whose availability this is: the on-behalf-of target a save writes to. */
  studentEmail: string;
  /** All of the position's blocks, for the live hours calculation. */
  blocks: ShiftBlock[];
  /** The position, for the hours floor and the hard-rule checks a save re-runs. */
  position: Position;
  /** The student's stored desired hours; part of the same checks. */
  desiredHours: number | null;
  /** The student's weekend rotation: drives the badge and the weekend ×0.5 factor. */
  everyWeekendOptIn: boolean;
  /** Weekly hours cap (scheduler-side context), for the over-cap cue. */
  cap: number;
  /** False before any generation: schedule mode stays disabled. */
  hasCurrentRun: boolean;
  /**
   * Whether this student has any generated shift in the current run. Drives the
   * cell split: with a schedule the cell shows preference against assignment; with
   * none the preference fills the whole square (there is nothing to compare to).
   */
  hasSchedule: boolean;
}

/** How long "Saved" stays up before the button retires itself. */
const SAVED_MS = 2000;

/** Pull the persisted overlays (picks, auto weekend, assignments) out of the grid. */
function referenceKeys(grid: AdminGridModel): {
  preferred: Set<string>;
  auto: Set<string>;
  assigned: Map<string, AssignmentSource>;
} {
  const preferred = new Set<string>();
  const auto = new Set<string>();
  const assigned = new Map<string, AssignmentSource>();
  for (const sub of [grid.weekday, grid.weekend]) {
    if (!sub) continue;
    for (const row of sub.rows) {
      row.cells.forEach((cell, i) => {
        const key = selectionKey(row.block.id, sub.days[i]!);
        if (cell.selected) preferred.add(key);
        if (cell.autoAssigned) auto.add(key);
        if (cell.assignmentSource) assigned.set(key, cell.assignmentSource);
      });
    }
  }
  return { preferred, auto, assigned };
}

export function PrefGridCalculator(props: PrefGridCalculatorProps) {
  const router = useRouter();
  const { preferred, auto, assigned } = useMemo(() => referenceKeys(props.grid), [props.grid]);
  const [mode, setMode] = useState<Mode>("prefs");
  const [mock, setMock] = useState<Set<string>>(() => new Set(preferred));
  // The rotation is part of the trial too: flipping the pill re-weights the
  // weekend (x0.5 under A/B, x1.0 every-weekend) without touching the student's
  // real answer.
  const [optIn, setOptIn] = useState(props.everyWeekendOptIn);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // The failing hard checks a save must acknowledge, or null when none pending.
  const [overrideChecks, setOverrideChecks] = useState<string[] | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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

  /**
   * The auto-assigned weekend is hours the student never offered but would work
   * anyway, so it sits outside preference capacity. While the trial's weekend is
   * auto-only, the readout shows a range (picks .. picks + auto) with the upper
   * bound marked as optional; picking any weekend shift replaces the auto shift,
   * and the range collapses to the single number that pick already counts for.
   */
  const autoWeekend = useMemo(
    () =>
      keysToSelection(auto).filter(
        (s) => validIds.has(s.blockId) && dayTypeOf(s.day) === "weekend",
      ),
    [auto, validIds],
  );
  const trialHasWeekend = selection.some((s) => dayTypeOf(s.day) === "weekend");
  const showAutoRange = autoWeekend.length > 0 && !trialHasWeekend;
  const hoursWithAuto = useMemo(
    () =>
      showAutoRange
        ? computeCapacity([...selection, ...autoWeekend], props.blocks, {
            everyWeekendOptIn: optIn,
          }).weeklyAverageHours
        : hours,
    [showAutoRange, selection, autoWeekend, props.blocks, optIn, hours],
  );

  const belowFloor = mock.size > 0 && hours < props.position.minHours;
  const overCap = hours > props.cap;
  // The rotation no longer matches the student's answer: the pill is a trial override.
  const rotationDeviates = optIn !== props.everyWeekendOptIn;
  const dirty =
    rotationDeviates || mock.size !== preferred.size || [...mock].some((k) => !preferred.has(k));

  // Save offers itself only when there is something to save, and lingers just long
  // enough afterwards to say so.
  const saving = saveState === "saving";
  const saved = saveState === "saved";
  const showSave = dirty || saveState !== "idle";

  // "Saved" is a receipt for the save that just landed, so it retires on its own
  // rather than sitting there over a grid the admin has moved on from.
  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saveState]);

  /** The same hard checks the server re-runs before accepting a save. */
  function hardFailures(): string[] {
    const result = validateAvailability(selection, props.position, props.blocks, {
      everyWeekendOptIn: optIn,
    });
    const failures = result.checks
      .filter((c) => c.severity === "hard" && !c.passed)
      .map((c) => c.detail);
    const desired = checkDesiredHours(props.desiredHours, props.position);
    if (!desired.passed) failures.push(desired.detail);
    return failures;
  }

  function save() {
    const failures = hardFailures();
    if (failures.length > 0) {
      setOverrideChecks(failures);
      return;
    }
    doSave(false);
  }

  function doSave(override: boolean) {
    setOverrideChecks(null);
    setSaveError(null);
    setSaveState("saving");
    startTransition(async () => {
      const res = await saveAvailabilityFor(props.studentEmail, {
        selection,
        everyWeekendOptIn: optIn,
        overrideInvalid: override,
      });
      if (!res.ok) {
        setSaveError(res.errors[0] ?? "Something went wrong.");
        setSaveState("idle");
        return;
      }
      setSaveState("saved");
      // Re-renders the page around us: the trial we just saved comes back as the
      // student's picks, which is what drops `dirty` and retires the button.
      router.refresh();
    });
  }

  // Every edit below drops any "Saved" receipt and pending warning first: both
  // describe the trial as it was, so they must not linger over a changed one.
  function touchTrial() {
    setSaveState("idle");
    setOverrideChecks(null);
  }

  function reset() {
    touchTrial();
    setMock(new Set(preferred));
    setOptIn(props.everyWeekendOptIn);
  }

  function clear() {
    touchTrial();
    setMock(new Set());
  }

  function flipRotation() {
    touchTrial();
    setOptIn((v) => !v);
  }

  function togglePref(blockId: string, day: Day) {
    touchTrial();
    setMock((prev) => {
      const next = new Set(prev);
      const key = selectionKey(blockId, day);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Schedule mode: one click adds or removes the current run's row for the cell. */
  function toggleAssignment(blockId: string, day: Day) {
    if (busyCell) return;
    const key = selectionKey(blockId, day);
    setAssignError(null);
    setBusyCell(key);
    startTransition(async () => {
      const res = assigned.has(key)
        ? await removeManualAssignment(props.studentEmail, blockId, day)
        : await setManualAssignment(props.studentEmail, blockId, day);
      setBusyCell(null);
      if (!res.ok) {
        setAssignError(res.error ?? "Something went wrong.");
        return;
      }
      // The new assignment comes back as grid props.
      router.refresh();
    });
  }

  function onToggle(blockId: string, day: Day) {
    if (mode === "schedule") toggleAssignment(blockId, day);
    else togglePref(blockId, day);
  }

  // Split the cell into preference + schedule halves only when there's a schedule
  // to show against it: this student's generated shifts, or the schedule-edit mode
  // where the admin is placing them. Otherwise the preference fills the whole cell.
  const split = props.hasSchedule || mode === "schedule";

  // Untouched, the readout is just the student's own selection; it only becomes a
  // "trial schedule" once the admin edits a cell or the rotation.
  const statusText = overCap
    ? `over ${props.cap}h cap`
    : belowFloor
      ? `below ${props.position.minHours}h floor`
      : mock.size === 0
        ? "no shifts picked"
        : dirty
          ? "trial schedule"
          : "preferred";
  const accent = overCap
    ? "var(--color-text-danger)"
    : belowFloor
      ? "var(--color-text-warning)"
      : "var(--color-text-info)";

  return (
    <>
      {/* Header: title + the mode toggle share the top line; the hours readout gets
          its own line so a wider or narrower number can't shuffle the layout as the
          admin clicks. The Reset/Clear controls sit with the legend. */}
      <div style={headerRow}>
        <div style={titleRow}>
          <div style={sectionLabel}>Availability and schedule</div>
          <div role="group" aria-label="Edit mode" style={modeGroup}>
            <button
              type="button"
              aria-pressed={mode === "prefs"}
              onClick={() => setMode("prefs")}
              style={modeBtn(mode === "prefs")}
            >
              Edit preferences
            </button>
            <button
              type="button"
              aria-pressed={mode === "schedule"}
              disabled={!props.hasCurrentRun}
              onClick={() => setMode("schedule")}
              style={modeBtn(mode === "schedule")}
            >
              Edit schedule
            </button>
          </div>
        </div>
        {!props.hasCurrentRun && (
          <p style={modeNote}>Generate a schedule first on the schedule page.</p>
        )}
        {mode === "schedule" && (
          <p style={modeNote}>
            Updating the schedule can replace these shifts unless the student is marked scheduled.
          </p>
        )}
        <div style={badge} aria-live="polite">
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: accent }}>
            {showAutoRange ? (
              <>
                {fmtNum(hours)}
                <span
                  style={{ color: "var(--color-text-auto)" }}
                  title={`Includes the auto-assigned weekend shift: ${autoWeekend
                    .map((s) => describeCell(s, props.blocks))
                    .join(", ")}`}
                >
                  –{fmtHours(hoursWithAuto)}
                </span>
              </>
            ) : (
              fmtHours(hours)
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              whiteSpace: "nowrap",
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

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <SubHead>Weekday</SubHead>
          <CalcTable
            sub={props.grid.weekday}
            mode={mode}
            mock={mock}
            preferred={preferred}
            auto={auto}
            assigned={assigned}
            busyCell={busyCell}
            split={split}
            onToggle={onToggle}
          />
        </div>
        {props.grid.weekend && (
          <div>
            <SubHead>
              Weekend
              <button
                type="button"
                aria-pressed={optIn}
                onClick={flipRotation}
                style={weekendModeBadge(optIn, rotationDeviates)}
                title={
                  rotationDeviates
                    ? `Trial only. ${props.everyWeekendOptIn ? "The student chose every weekend." : "The student chose alternating (A/B)."} Click to switch back.`
                    : optIn
                      ? "Every weekend. Click to try alternating (A/B)."
                      : "Alternating (A/B). Click to try every weekend."
                }
              >
                {optIn ? "EVERY weekend" : "alternating (A/B)"}
              </button>
            </SubHead>
            <CalcTable
              sub={props.grid.weekend}
              mode={mode}
              mock={mock}
              preferred={preferred}
              auto={auto}
              assigned={assigned}
              busyCell={busyCell}
              split={split}
              onToggle={onToggle}
            />
          </div>
        )}
      </div>

      <div style={footerRow}>
        <Legend split={split} />
        {/* marginLeft keeps the controls in the bottom-right corner even when the
            legend is wide enough to push them onto their own line. */}
        {mode === "prefs" && (
          <div style={{ display: "flex", gap: 4, flex: "none", marginLeft: "auto" }}>
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
            <button type="button" onClick={clear} style={miniBtn} title="Clear every cell">
              Clear
            </button>
            {showSave && (
              <button
                type="button"
                onClick={save}
                disabled={saving || saved}
                style={saveBtn(saved)}
                title={
                  saved
                    ? "Saved to the student's availability"
                    : "Save this as the student's availability"
                }
              >
                {saving ? "Saving…" : saved ? "Saved" : "Save"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* The explicit "Save anyway" step: the trial fails hard checks, so the save
          waits until the admin has seen exactly which ones and accepts the flag. */}
      {overrideChecks && (
        <div role="status" style={overridePanel}>
          <p style={{ margin: 0, fontWeight: 600 }}>This does not pass the availability checks:</p>
          <ul style={overrideList}>
            {overrideChecks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p style={{ margin: "6px 0 8px" }}>Saving anyway flags the response for review.</p>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setOverrideChecks(null)} style={miniBtn}>
              Keep editing
            </button>
            <button type="button" onClick={() => doSave(true)} style={overrideBtn}>
              Save anyway
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <p role="status" style={saveErrorStyle}>
          {saveError}
        </p>
      )}
      {assignError && (
        <p role="status" style={saveErrorStyle}>
          {assignError}
        </p>
      )}
    </>
  );
}

/**
 * The scheduling week starts on Sunday, so Sun opens the week and Sat closes it
 * rather than the two forming one contiguous weekend (PLAN §7). A wider gap plus
 * a thin vertical rule between the two weekend columns makes that visible,
 * mirroring the split in the student grid (AvailabilityForm). The 3px
 * borderSpacing sits on the Sun side of the rule, hence the smaller padding.
 */
function weekSplit(sub: AdminSubGrid, day: Day): React.CSSProperties {
  if (sub.dayType !== "weekend") return {};
  if (day === "sun") return { paddingRight: 7 };
  return { borderLeft: "1px solid var(--color-border-secondary)", paddingLeft: 10 };
}

function CalcTable({
  sub,
  mode,
  mock,
  preferred,
  auto,
  assigned,
  busyCell,
  split,
  onToggle,
}: {
  sub: AdminSubGrid;
  mode: Mode;
  mock: Set<string>;
  preferred: Set<string>;
  auto: Set<string>;
  assigned: Map<string, AssignmentSource>;
  busyCell: string | null;
  split: boolean;
  onToggle: (blockId: string, day: Day) => void;
}) {
  return (
    <table style={{ width: "auto", borderCollapse: "separate", borderSpacing: 3, fontSize: 11 }}>
      <tbody>
        <tr style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>
          <td />
          {sub.days.map((d) => (
            <td key={d} style={{ width: CELL, textAlign: "center", ...weekSplit(sub, d) }}>
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
              const source = assigned.get(key) ?? null;
              const isHot = row.highDemandDays[i] ?? false;
              const pressed = mode === "schedule" ? source !== null : inMock;
              return (
                <td key={day} style={{ padding: 0, ...weekSplit(sub, day) }}>
                  <button
                    type="button"
                    aria-pressed={pressed}
                    aria-label={`${row.label} ${DAY_LABEL[day]}`}
                    title={cellTitle(mode, inMock, wasPreferred, wasAuto, source, isHot)}
                    onClick={() => onToggle(row.block.id, day)}
                    style={cellStyle(inMock, wasPreferred, wasAuto, source, busyCell === key, split)}
                  >
                    {isHot && <span aria-hidden style={hotTick} />}
                    {inMock && (
                      <span aria-hidden style={split ? prefTick : prefTickFull}>
                        ✓
                      </span>
                    )}
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

function cellTitle(
  mode: Mode,
  inMock: boolean,
  wasPreferred: boolean,
  wasAuto: boolean,
  source: AssignmentSource | null,
  isHot: boolean,
): string {
  const parts: string[] = [];
  if (mode === "schedule") {
    if (source === "manual") parts.push("Scheduled by hand. Click to remove.");
    else if (source === "engine") parts.push("Scheduled. Click to remove.");
    else parts.push("Click to schedule this shift.");
    if (wasPreferred || wasAuto)
      parts.push(wasAuto ? "auto-assigned weekend" : "the student picked this");
    else parts.push("not one the student picked");
  } else {
    if (inMock)
      parts.push(
        wasPreferred || wasAuto
          ? "In trial schedule"
          : "In trial schedule (not one the student picked)",
      );
    else if (wasPreferred) parts.push("Student picked this; not in the trial schedule");
    else if (wasAuto) parts.push("Auto-assigned; not in the trial schedule");
    else parts.push("Click to add to the trial schedule");
    if (source === "manual") parts.push("scheduled by hand");
    else if (source === "engine") parts.push("scheduled this run");
  }
  if (isHot) parts.push("a lot of students picked this shift");
  return parts.join(" · ");
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: "var(--color-text-secondary)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Legend({ split }: { split: boolean }) {
  return (
    <div style={legendCol}>
      {/* The split only exists once there's a schedule run to compare against;
          without one the cells are whole preference squares. */}
      {split && <div>Lower left: their preference. Upper right: scheduled shift.</div>}
      <div style={legendRow}>
        <span>
          <span style={prefSwatch("var(--color-text-info)", split)} /> in trial schedule
        </span>
        <span>
          <span style={prefSwatch(PREF_PICKED_COLOR, split)} /> picked, not in trial
        </span>
        <span>
          <span style={prefSwatch("var(--color-background-warning)", split)} /> auto-assigned
        </span>
        {split && (
          <>
            <span>
              <span style={schedSwatch(ENGINE_COLOR)} /> scheduled
            </span>
            <span>
              <span style={schedSwatch(MANUAL_COLOR)} /> scheduled by hand
            </span>
          </>
        )}
        <span>
          <span
            style={{
              display: "inline-block",
              width: 3,
              height: 11,
              background: "var(--color-text-danger)",
              verticalAlign: -1,
            }}
          />{" "}
          high-demand
        </span>
      </div>
    </div>
  );
}

// --- styles ---

/**
 * The readout always sits on its own line under the title, never inline, even when
 * it would fit. Inline, a wider or narrower number reflows the header on every click.
 */
const headerRow: React.CSSProperties = {
  marginBottom: 10,
};
const titleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--color-text-primary)",
};
/** Hours and status sit side by side on the readout line, hard against the title. */
const badge: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
  marginTop: 2,
};
/** The two-mode switch; the active mode reads as the pressed segment. */
const modeGroup: React.CSSProperties = {
  display: "inline-flex",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  overflow: "hidden",
};
const modeBtn = (active: boolean): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 10px",
  border: "none",
  cursor: "pointer",
  background: active ? "var(--color-text-info)" : "var(--color-background-primary)",
  color: active ? "#fff" : "var(--color-text-secondary)",
});
const modeNote: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 11,
  color: "var(--color-text-secondary)",
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
/**
 * Save is the one control here that writes, so it carries weight the quiet
 * Reset/Clear pair doesn't. Once saved it drops to a green receipt: still the same
 * button in the same spot, no longer offering to do anything.
 */
const saveBtn = (done: boolean): React.CSSProperties => ({
  ...miniBtn,
  fontWeight: 600,
  ...(done
    ? {
        background: "var(--color-background-primary)",
        border: "1px solid var(--color-text-success)",
        color: "var(--color-text-success)",
        cursor: "default",
      }
    : {
        background: "var(--color-text-info)",
        border: "1px solid var(--color-text-info)",
        color: "#fff",
      }),
});
/** The failed-checks warning: quiet amber, with the one red action inside it. */
const overridePanel: React.CSSProperties = {
  marginTop: 10,
  padding: "8px 10px",
  fontSize: 12,
  background: "var(--color-background-warning)",
  border: "1px solid var(--color-border-warning)",
  borderRadius: "var(--border-radius-md)",
};
const overrideList: React.CSSProperties = {
  margin: "4px 0 0",
  paddingLeft: 18,
};
const overrideBtn: React.CSSProperties = {
  ...miniBtn,
  fontWeight: 600,
  background: "var(--color-text-danger)",
  border: "1px solid var(--color-text-danger)",
  color: "#fff",
};
const saveErrorStyle: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: 12,
  textAlign: "right",
  color: "var(--color-text-danger)",
};
const hotTick: React.CSSProperties = {
  position: "absolute",
  top: 1,
  left: 1,
  width: 3,
  height: 7,
  background: "var(--color-text-danger)",
  borderRadius: 1,
  pointerEvents: "none",
};
/** The trial check sits in the preference (lower-left) half of the split. */
const prefTick: React.CSSProperties = {
  position: "absolute",
  left: 2,
  bottom: 0,
  fontSize: 9,
  color: "#fff",
  pointerEvents: "none",
};
/** With no schedule to split against, the cell is whole, so the check centers. */
const prefTickFull: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  color: "#fff",
  pointerEvents: "none",
};
/** Legend on the left, the trial controls on the right, sharing the card's last row. */
const footerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 12,
};
const legendCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "var(--color-text-secondary)",
};
const legendRow: React.CSSProperties = {
  display: "flex",
  gap: 14,
  flexWrap: "wrap",
};
const swatch: React.CSSProperties = {
  display: "inline-block",
  width: 11,
  height: 11,
  borderRadius: 3,
  verticalAlign: -1,
  border: "1px solid var(--color-border-tertiary)",
};
/**
 * A legend swatch for a preference color: the lower-left half when the cell is
 * split against a schedule, the whole swatch when there's no run to split against.
 */
const prefSwatch = (color: string, split: boolean): React.CSSProperties => ({
  ...swatch,
  background: split ? `linear-gradient(45deg, ${color} 0 50%, ${EMPTY_COLOR} 50% 100%)` : color,
});
/** A legend swatch showing a color in the schedule (upper-right) half. */
const schedSwatch = (color: string): React.CSSProperties => ({
  ...swatch,
  background: `linear-gradient(45deg, ${EMPTY_COLOR} 0 50%, ${color} 50% 100%)`,
});

/**
 * The weekend rotation, made unmissable: opt-ins get a filled badge, A/B a quiet
 * one. It's also the toggle that re-weights the weekend in the trial, so it carries
 * button affordances, plus, once flipped away from what the student actually chose,
 * the same amber dashed ring the grid uses for cells they never offered.
 */
const weekendModeBadge = (every: boolean, deviates: boolean): React.CSSProperties => ({
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
    ? {
        background: "var(--color-text-info)",
        color: "#fff",
        border: "1px solid var(--color-text-info)",
      }
    : {
        background: "var(--color-background-secondary)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border-tertiary)",
      }),
  ...(deviates ? { border: "1.5px dashed var(--color-border-warning)" } : null),
});

/** The preference half's fill (the whole cell when there is no schedule to split). */
function prefFill(inMock: boolean, wasPreferred: boolean, wasAuto: boolean): string {
  if (inMock) return "var(--color-text-info)";
  if (wasPreferred) return PREF_PICKED_COLOR;
  if (wasAuto) return "var(--color-background-warning)";
  return EMPTY_COLOR;
}

/** The schedule (upper-right) half's fill: green engine rows, violet manual ones. */
function schedFill(source: AssignmentSource | null): string {
  if (source === "manual") return MANUAL_COLOR;
  if (source === "engine") return ENGINE_COLOR;
  return EMPTY_COLOR;
}

function cellStyle(
  inMock: boolean,
  wasPreferred: boolean,
  wasAuto: boolean,
  source: AssignmentSource | null,
  busy: boolean,
  split: boolean,
): React.CSSProperties {
  const pref = prefFill(inMock, wasPreferred, wasAuto);
  return {
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
    // With a schedule run the cell splits: lower-left = preference, upper-right =
    // schedule (see Legend). With no run there's nothing to compare against, so the
    // preference fills the whole square.
    background: split
      ? `linear-gradient(45deg, ${pref} 0 50%, ${schedFill(source)} 50% 100%)`
      : pref,
    // A cell the student never offered, now in the trial, gets an amber ring.
    border:
      inMock && !wasPreferred && !wasAuto
        ? "1.5px dashed var(--color-border-warning)"
        : "1px solid var(--color-border-tertiary)",
    opacity: busy ? 0.5 : 1,
  };
}
