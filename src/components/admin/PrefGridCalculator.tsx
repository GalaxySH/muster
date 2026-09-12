"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminGridModel, AdminSubGrid } from "@/lib/admin/summary";
import { computeCapacity } from "@/lib/domain/capacity";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { keysToSelection, selectionKey } from "@/lib/availability/selection";
import { saveAvailabilityFor } from "@/lib/availability/actions";
import { removeOrphanedSelection } from "@/lib/admin/actions";
import type { OrphanedCell } from "@/lib/positions/orphans";
import { applyScheduleEdits } from "@/lib/schedule/manual";
import { ENGINE_COLOR, MANUAL_COLOR } from "@/components/admin/schedule-ui";
import { dayConflictMessage, findDayConflict, type RowSpan } from "@/lib/domain/scheduling/manual";
import { isBelowMinHours } from "@/lib/domain/scheduling/problems";
import type { AssignmentSource, Cohort } from "@/lib/domain/scheduling/types";
import { EPSILON_MINUTES, formatTime } from "@/lib/domain/time";
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
 * cycle-averaged hours (`computeCapacity`), and Save writes the INTERNAL copy
 * (PLAN §10a): the student's own submission is never modified, and scheduling
 * surfaces read the internal copy in its place. Hard-rule failures warn
 * instead of blocking here: Save lists the failing checks and offers "Save
 * anyway", which persists without raising any flag (the internal copy is the
 * admin's own working state). Only this admin surface gets the override; the
 * student form keeps refusing.
 *
 * **Edit schedule** is the same trial + Save shape (1.15). Clicks build a local
 * trial of the run's rows for this student; nothing is written until Save,
 * which sends the whole diff to `applyScheduleEdits` as one transaction. A
 * click that would break the unique-coverage rule is refused here, with the
 * sentence the server would use (`domain/scheduling/manual.ts`), so the admin
 * learns it at the cell rather than at Save; the save-time check on the final
 * state is still the truth. Pending cells carry the amber dashed ring the grid
 * already uses for "deviates". Rows are added as source "manual"; removing an
 * engine row is allowed. Disabled until a run exists.
 *
 * The weekend header's rotation control belongs to whichever mode is on (1.24),
 * because the two modes ask different questions of it. In preferences it is the
 * student's own answer, re-weighting the preferred hours. In schedule it is the
 * RUN's rotation, read off their current-run rows: flipping it moves every
 * weekend row they hold, and while the plan is alternating an A/B pair beside it
 * picks the week. It rides the same trial as the cells, so Save carries it in
 * the same batch and Reset drops it with them.
 *
 * The header carries BOTH hour figures at once, because the question the admin
 * is asking changes with the mode and the other number is still worth a glance:
 * the trial's preferred hours and the run's scheduled hours. Whichever the
 * current mode is about takes the full size and the status line, the other
 * shrinks to a labelled miniature beside it, so the two can never be mistaken
 * for each other.
 */

// Compact fixed cell size; keeps the grid tight instead of stretching wide.
const CELL = 26;

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
  /**
   * The student's cycle-averaged SCHEDULED minutes in the current run, totalled
   * on the server from the run's own rows (the same measure the schedule page's
   * student table shows). Null before any generation, which hides the scheduled
   * readout entirely. Deliberately not derived from the grid cells: a row
   * carried on a retired shift has no cell and would go missing.
   */
  scheduledMinutes: number | null;
  /**
   * The rotation week the current run puts this student's weekend on, or null
   * when they hold no weekend row (and before any generation). Schedule mode's
   * rotation control edits this; preference mode's pill edits
   * `everyWeekendOptIn` beside it, which is a different question about a
   * different table.
   */
  scheduleCohort: Exclude<Cohort, "weekday"> | null;
  /** False before any generation: schedule mode stays disabled. */
  hasCurrentRun: boolean;
  /**
   * Whether this student has any generated shift in the current run. Drives the
   * cell split: with a schedule the cell shows preference against assignment; with
   * none the preference fills the whole square (there is nothing to compare to).
   */
  hasSchedule: boolean;
  /**
   * True when the grid shows a saved internal copy rather than the student's
   * own picks; the cell tooltips stop attributing the picks to the student.
   */
  isInternal: boolean;
  /**
   * The student's own stored cells (their picks plus the machine-assigned
   * weekend), passed only when an internal copy is loaded. Drives the per-cell
   * diff cues: an amber dashed ring on cells the student never picked, a blue
   * dotted ring on student cells the copy dropped. Null hides the cues (the
   * grid already IS the student's own answers).
   */
  studentCells: SelectedShift[] | null;
  /**
   * Picks left on shifts that no longer exist (PLAN §6.2a). They render as
   * their own greyed rows under the live ones, showing the hours the student
   * originally picked. Nothing can be added on such a row; the only thing the
   * admin can do is clear a pick, which removes it for good.
   */
  orphans: OrphanedCell[];
}

/** How long "Saved" stays up before the button retires itself. */
const SAVED_MS = 2000;

type SaveState = "idle" | "saving" | "saved";

/**
 * One Save button's state. "Saved" is a receipt for the save that just landed,
 * so it retires on its own rather than sitting there over a grid the admin has
 * moved on from. Both modes save, so both get their own receipt.
 */
function useSaveState(): [SaveState, (next: SaveState) => void] {
  const [state, setState] = useState<SaveState>("idle");
  useEffect(() => {
    if (state !== "saved") return;
    const timer = setTimeout(() => setState("idle"), SAVED_MS);
    return () => clearTimeout(timer);
  }, [state]);
  return [state, setState];
}

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
  const [saveState, setSaveState] = useSaveState();
  const [saveError, setSaveError] = useState<string | null>(null);
  // The failing hard checks a save must acknowledge, or null when none pending.
  const [overrideChecks, setOverrideChecks] = useState<string[] | null>(null);
  // The schedule trial: the run's rows for this student as the admin is
  // shaping them. Seeded from what is persisted, so a clean trial is exactly
  // the schedule; after a save the refreshed props come back equal to it,
  // which is what drops `scheduleDirty` again.
  const [trial, setTrial] = useState<Set<string>>(() => new Set(assigned.keys()));
  // The rotation week the trial puts their weekend on. Seeded the same way the
  // cells are, from what is persisted, so a clean trial is exactly the schedule;
  // with no weekend row to read it from, it starts where a new one would land.
  const savedCohort: Exclude<Cohort, "weekday"> =
    props.scheduleCohort ?? (props.everyWeekendOptIn ? "every" : "a");
  const [schedCohort, setSchedCohort] = useState(savedCohort);
  const [schedSaveState, setSchedSaveState] = useSaveState();
  const [assignError, setAssignError] = useState<string | null>(null);
  // Labor notes from the last saved batch; the shifts are placed anyway.
  const [assignWarnings, setAssignWarnings] = useState<string[] | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [orphanError, setOrphanError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Clear one dead pick. It is gone from both copies once this returns, so the
   * server is the only source of truth here: refresh rather than hide the row
   * locally, and let the flag re-sync decide what the page shows next.
   */
  function removeOrphan(blockId: string, day: Day) {
    const key = selectionKey(blockId, day);
    setOrphanError(null);
    setBusyCell(key);
    startTransition(async () => {
      const res = await removeOrphanedSelection(props.studentEmail, blockId, day);
      setBusyCell(null);
      if (!res.ok) setOrphanError(res.error ?? "Could not remove that pick.");
      else router.refresh();
    });
  }

  // Guard against any stray key referencing an unknown block (computeCapacity throws).
  const validIds = useMemo(() => new Set(props.blocks.map((b) => b.id)), [props.blocks]);
  const blockById = useMemo(() => new Map(props.blocks.map((b) => [b.id, b])), [props.blocks]);
  // The student's own cells, for the diff cues against a loaded internal copy.
  const studentKeys = useMemo(
    () =>
      props.studentCells
        ? new Set(props.studentCells.map((c) => selectionKey(c.blockId, c.day)))
        : null,
    [props.studentCells],
  );
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

  // --- the schedule trial ---
  const schedAdds = useMemo(() => [...trial].filter((k) => !assigned.has(k)), [trial, assigned]);
  const schedRemoves = useMemo(
    () => [...assigned.keys()].filter((k) => !trial.has(k)),
    [trial, assigned],
  );
  // A rotation with no weekend shift to put in it is not a change: there is
  // nothing for it to move, and counting it would leave Save offering to write
  // nothing and never settling afterwards.
  const trialWeekendRows = useMemo(
    () => keysToSelection(trial).some((s) => dayTypeOf(s.day) === "weekend"),
    [trial],
  );
  const rotationMoves = schedCohort !== savedCohort && trialWeekendRows;
  const scheduleDirty = schedAdds.length > 0 || schedRemoves.length > 0 || rotationMoves;
  // The trial's rows in the shape the coverage rule reads, for the per-click cue.
  const trialRows = useMemo<RowSpan[]>(
    () =>
      keysToSelection(trial).flatMap(({ blockId, day }) => {
        const block = blockById.get(blockId);
        return block ? [{ blockId, day, start: block.start, end: block.end }] : [];
      }),
    [trial, blockById],
  );

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

  // The floor is the one hours rule preferences answer to: it asks whether the
  // picks can REACH the minimum. The cap is deliberately not judged here, since
  // selecting past it is expected (PLAN §5 #3); it is judged on the scheduled
  // figure below, which is the one it constrains.
  const belowFloor = mock.size > 0 && hours < props.position.minHours;
  // The rotation no longer matches the student's answer: the pill is a trial override.
  const rotationDeviates = optIn !== props.everyWeekendOptIn;
  const dirty =
    rotationDeviates || mock.size !== preferred.size || [...mock].some((k) => !preferred.has(k));

  // Save offers itself only when there is something to save, and lingers just long
  // enough afterwards to say so.
  const saving = saveState === "saving";
  const saved = saveState === "saved";
  const showSave = dirty || saveState !== "idle";
  const schedSaving = schedSaveState === "saving";
  const schedSaved = schedSaveState === "saved";
  const showSchedSave = scheduleDirty || schedSaveState !== "idle";

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

  /**
   * Schedule mode: one click adds or removes the cell in the TRIAL. Nothing is
   * written until Save. Removals are pure set arithmetic, so they are always
   * allowed here even where a per-click server edit used to refuse them: a
   * removal that leaves another row covering nothing can be legal in a batch
   * where a later add covers it, and the save re-checks the final state anyway.
   * An add that breaks the coverage rule against the trial as it stands is
   * refused right here, in the words the server would use.
   */
  /**
   * The schedule-trial counterpart of `touchTrial`: the refusal, the warnings
   * and the "Saved" receipt all describe the trial as it was, so any edit drops
   * them before changing it.
   */
  function touchSchedule() {
    setAssignError(null);
    setAssignWarnings(null);
    setSchedSaveState("idle");
  }

  function toggleAssignment(blockId: string, day: Day) {
    if (busyCell || schedSaveState === "saving") return;
    const key = selectionKey(blockId, day);
    touchSchedule();
    if (trial.has(key)) {
      setTrial((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    const block = blockById.get(blockId);
    if (block) {
      const clash = findDayConflict(block, day, trialRows);
      if (clash) {
        setAssignError(dayConflictMessage(block, day, clash));
        return;
      }
    }
    setTrial((prev) => new Set(prev).add(key));
  }

  function resetSchedule() {
    touchSchedule();
    setTrial(new Set(assigned.keys()));
    setSchedCohort(savedCohort);
  }

  /**
   * Which rotation week the run puts their weekend shifts on. Every weekend
   * means both weeks; otherwise it is one of them, and the A/B buttons beside
   * the pill pick which. Leaving every-weekend lands on the week the run
   * recorded if it had one, since that is the change the admin is undoing.
   */
  function flipScheduleRotation() {
    touchSchedule();
    setSchedCohort((v) => (v === "every" ? (props.scheduleCohort === "b" ? "b" : "a") : "every"));
  }

  function setRotationWeek(week: "a" | "b") {
    touchSchedule();
    setSchedCohort(week);
  }

  /** Send the whole diff as one batch; the server applies all of it or none. */
  function saveSchedule() {
    setAssignError(null);
    setAssignWarnings(null);
    setSchedSaveState("saving");
    startTransition(async () => {
      try {
        const res = await applyScheduleEdits(
          props.studentEmail,
          keysToSelection(schedRemoves),
          keysToSelection(schedAdds),
          // Sent only when the admin actually moved it. Left out, the server
          // keeps each standing row where it is, which is what stops a batch
          // of cell edits from quietly normalizing rows that carry a mix.
          rotationMoves ? schedCohort : undefined,
        );
        if (!res.ok) {
          // The trial survives a refusal: the error names a cell, and the admin
          // needs the rest of their composition still on screen to fix it.
          setAssignError(res.error ?? "Something went wrong.");
          setSchedSaveState("idle");
          return;
        }
        if (res.warnings && res.warnings.length > 0) setAssignWarnings(res.warnings);
        setSchedSaveState("saved");
        // The saved rows come back as grid props, which is what settles the trial.
        router.refresh();
      } catch {
        // A THROW, not a refusal: a dropped connection, a row another admin got
        // to first. startTransition swallows it, so without this the button sits
        // disabled on "Saving…" and the grid dead-ends. Whether the batch landed
        // is genuinely unknown here (a commit can be followed by a failed
        // refresh), so the line says to look rather than promising nothing
        // happened.
        setAssignError("Could not save those changes. Reload the page to check, then try again.");
        setSchedSaveState("idle");
      }
    });
  }

  function onToggle(blockId: string, day: Day) {
    if (mode === "schedule") toggleAssignment(blockId, day);
    else togglePref(blockId, day);
  }

  /**
   * Switching modes keeps a dirty schedule trial in memory: it took work to
   * compose and looking at the preferences is often part of composing it. Only
   * the schedule notices go, since they describe a screen the admin left.
   */
  function switchMode(next: Mode) {
    setAssignError(null);
    setAssignWarnings(null);
    setMode(next);
  }

  // Split the cell into preference + schedule halves only when there's a schedule
  // to show against it: this student's generated shifts, or the schedule-edit mode
  // where the admin is placing them. Otherwise the preference fills the whole cell.
  const split = props.hasSchedule || mode === "schedule";

  // Untouched, the readout is just the student's own selection; it only becomes a
  // "trial schedule" once the admin edits a cell or the rotation.
  const statusText = belowFloor
    ? `below ${props.position.minHours}h floor`
    : mock.size === 0
      ? "no shifts picked"
      : dirty
        ? "trial schedule"
        : "preferred";
  const accent = belowFloor ? "var(--color-text-warning)" : "var(--color-text-info)";

  /**
   * The scheduled figure follows the trial while schedule mode is dirty. It is
   * the server's total plus a DELTA between the trial's grid cells and the
   * persisted ones, never a fresh total over the trial: `scheduledMinutes`
   * counts rows carried on retired shifts, which have no cell here, and a delta
   * leaves them counted. Each side is weighted by its own rotation, the trial's
   * against the run's, so moving somebody onto every weekend re-weights the
   * weekend here as well as in the rows the save writes. Neither side reads the
   * preference trial's pill, which answers a different question.
   *
   * One case the delta cannot get right: a trialed cell that overlaps a retired
   * shift's row on the same day. The server merges the two spans into one
   * clock-in; the delta counts the trialed cell whole, so the preview can read
   * high until the save comes back. A rotation move is the same shape, since a
   * retired row re-weights on the server and has no cell here to re-weight.
   * Accepted, because the figure it lands on and the server's over-cap warning
   * are both computed from the merged truth.
   */
  const gridMinutes = (keys: Iterable<string>, everyWeekend: boolean) =>
    computeCapacity(
      keysToSelection(keys).filter((s) => validIds.has(s.blockId)),
      props.blocks,
      { everyWeekendOptIn: everyWeekend },
    ).weeklyAverageMinutes;
  // Schedule mode only: in preference mode the scheduled figure is an unlabelled
  // miniature, so it stays the run as it stands rather than quietly reading as a trial.
  const scheduleIsTrial = mode === "schedule" && scheduleDirty;
  const trialDelta = scheduleIsTrial
    ? gridMinutes(trial, schedCohort === "every") -
      gridMinutes(assigned.keys(), savedCohort === "every")
    : 0;
  const trialMinutes = props.scheduledMinutes === null ? null : props.scheduledMinutes + trialDelta;
  const scheduledHours = trialMinutes === null ? null : trialMinutes / 60;
  // The cap is a hard generation rule since 1.15, so a composition that breaks
  // it should get loud in the trial, before the admin saves it. Judged in
  // MINUTES against the same epsilon `isOverMaxHours` uses
  // (domain/scheduling/problems.ts): averaged minutes are float-valued, so
  // sitting exactly on the cap must never read as over it, and the cue must not
  // disagree with the over-max flag the schedule page will raise afterwards.
  // The figure beside it is rounded for reading; the comparison is not.
  const scheduledOverCap = trialMinutes !== null && trialMinutes - EPSILON_MINUTES > props.cap * 60;
  // The same pair of judgements the schedule page's student table pills carry,
  // on the same predicates, so the two surfaces never disagree about somebody.
  // Nothing scheduled at all reads as its own state rather than as a floor
  // miss: the admin can see there is nothing there.
  const scheduledBelowFloor =
    trialMinutes !== null &&
    scheduledHours !== 0 &&
    isBelowMinHours(trialMinutes, props.position.minHours);
  const scheduledJudged = scheduledOverCap || scheduledBelowFloor;
  const scheduledAccent = scheduledOverCap
    ? "var(--color-text-danger)"
    : scheduledBelowFloor
      ? "var(--color-text-warning)"
      : scheduledHours === 0
        ? "var(--color-text-secondary)"
        : "var(--color-text-info)";
  // Same wording as the schedule page's pills, so the two agree.
  const scheduledNote = scheduledOverCap
    ? `over ${props.cap}h cap`
    : scheduledBelowFloor
      ? `below ${props.position.minHours}h floor`
      : null;
  const scheduledStatus =
    scheduledNote ??
    (scheduleIsTrial ? "trial schedule" : scheduledHours === 0 ? "nothing scheduled" : "scheduled");
  // Mini form of the preferred figure: the auto-weekend range survives, since
  // dropping it here would quietly restate an upper bound as a single number.
  const preferredMini = showAutoRange
    ? `${fmtNum(hours)}–${fmtHours(hoursWithAuto)} preferred`
    : `${fmtHours(hours)} preferred`;
  // Schedule mode without a run cannot happen (the button is disabled), but the
  // fallback keeps the preferred readout big rather than rendering nothing.
  const scheduleIsBig = mode === "schedule" && scheduledHours !== null;

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
              onClick={() => switchMode("prefs")}
              style={modeBtn(mode === "prefs")}
            >
              Edit preferences
            </button>
            <button
              type="button"
              aria-pressed={mode === "schedule"}
              disabled={!props.hasCurrentRun}
              onClick={() => switchMode("schedule")}
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
        {/* Preferred always first, scheduled always second, whichever mode is on.
            Switching modes only moves the emphasis between them: a figure that
            jumped sides as well would have to be re-found on every click. */}
        <div style={badge} aria-live="polite">
          <Readout
            big={!scheduleIsBig}
            accent={accent}
            judged={belowFloor}
            status={
              <>
                {statusText}
                {mock.size > 0 && !belowFloor && (
                  <span style={{ color: "var(--color-text-tertiary)" }}>
                    {" "}
                    · {dayCount} day{dayCount === 1 ? "" : "s"}
                  </span>
                )}
              </>
            }
            mini={preferredMini}
          >
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
          </Readout>
          {scheduledHours !== null && (
            <Readout
              big={scheduleIsBig}
              accent={scheduledAccent}
              judged={scheduledJudged}
              status={scheduledStatus}
              // Shrunk, the figure still has to carry its own verdict, or an
              // over-cap schedule goes quiet the moment the admin leaves
              // schedule mode.
              mini={`${fmtHours(scheduledHours)} scheduled${scheduledNote ? ` · ${scheduledNote}` : ""}`}
            >
              {fmtHours(scheduledHours)}
            </Readout>
          )}
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
            trial={trial}
            busyCell={busyCell}
            split={split}
            isInternal={props.isInternal}
            studentKeys={studentKeys}
            onToggle={onToggle}
            orphans={props.orphans}
            onRemoveOrphan={removeOrphan}
          />
        </div>
        {props.grid.weekend && (
          <div>
            <SubHead>
              Weekend
              {/* Two rotations, one per mode, because they are two different
                  facts: what the student is available for, and which week the
                  schedule actually puts them on. */}
              {mode === "schedule" ? (
                <>
                  <button
                    type="button"
                    aria-pressed={schedCohort === "every"}
                    onClick={flipScheduleRotation}
                    style={weekendModeBadge(schedCohort === "every", rotationMoves)}
                    title={
                      schedCohort === "every"
                        ? "They work both weeks. Click to put them on one."
                        : "They work every other week. Click to put them on both."
                    }
                  >
                    {schedCohort === "every" ? "EVERY weekend" : "alternating (A/B)"}
                  </button>
                  {schedCohort !== "every" && (
                    <span role="group" aria-label="Rotation week" style={weekGroup}>
                      {(["a", "b"] as const).map((week) => (
                        <button
                          key={week}
                          type="button"
                          aria-pressed={schedCohort === week}
                          onClick={() => setRotationWeek(week)}
                          style={weekBtn(schedCohort === week)}
                          title={`Put their weekend shifts in week ${week.toUpperCase()}`}
                        >
                          {week.toUpperCase()}
                        </button>
                      ))}
                    </span>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  aria-pressed={optIn}
                  onClick={flipRotation}
                  style={weekendModeBadge(optIn, rotationDeviates)}
                  title={
                    rotationDeviates
                      ? `Trial only. ${props.everyWeekendOptIn ? (props.isInternal ? "The saved copy has every weekend." : "The student chose every weekend.") : props.isInternal ? "The saved copy has alternating (A/B)." : "The student chose alternating (A/B)."} Click to switch back.`
                      : optIn
                        ? "Every weekend. Click to try alternating (A/B)."
                        : "Alternating (A/B). Click to try every weekend."
                  }
                >
                  {optIn ? "EVERY weekend" : "alternating (A/B)"}
                </button>
              )}
            </SubHead>
            <CalcTable
              sub={props.grid.weekend}
              mode={mode}
              mock={mock}
              preferred={preferred}
              auto={auto}
              assigned={assigned}
              trial={trial}
              busyCell={busyCell}
              split={split}
              isInternal={props.isInternal}
              studentKeys={studentKeys}
              onToggle={onToggle}
              orphans={props.orphans}
              onRemoveOrphan={removeOrphan}
            />
          </div>
        )}
      </div>

      <div style={footerRow}>
        <Legend split={split} showDiff={studentKeys !== null} showPending={mode === "schedule"} />
        {/* marginLeft keeps the controls in the bottom-right corner even when the
            legend is wide enough to push them onto their own line. */}
        {mode === "prefs" ? (
          <div style={{ display: "flex", gap: 4, flex: "none", marginLeft: "auto" }}>
            {dirty && (
              <button
                type="button"
                onClick={reset}
                style={miniBtn}
                title="Reset to the saved picks"
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
                    ? "Saved as the internal copy used for scheduling"
                    : "Save as the internal copy used for scheduling. The student's own answers are kept."
                }
              >
                {saving ? "Saving…" : saved ? "Saved" : "Save"}
              </button>
            )}
          </div>
        ) : (
          /* No Clear here: wiping a whole schedule should not be one click. */
          <div style={{ display: "flex", gap: 4, flex: "none", marginLeft: "auto" }}>
            {scheduleDirty && (
              <button
                type="button"
                onClick={resetSchedule}
                style={miniBtn}
                title="Drop the pending changes"
              >
                Reset
              </button>
            )}
            {showSchedSave && (
              <button
                type="button"
                onClick={saveSchedule}
                disabled={schedSaving || schedSaved || busyCell !== null}
                style={saveBtn(schedSaved)}
                title={
                  schedSaved
                    ? "Saved to the current schedule"
                    : "Write the pending changes to the current schedule"
                }
              >
                {schedSaving ? "Saving…" : schedSaved ? "Saved" : "Save"}
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
          <p style={{ margin: "6px 0 8px" }}>Saving anyway keeps shifts that fail these checks.</p>
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
      {/* Non-blocking labor notes on the week the save landed on: the shifts are
          placed, the admin decides. Deliberately quieter than the amber
          acknowledge panel, which blocks. */}
      {assignWarnings && (
        <div role="status" style={laborNotePanel}>
          <p style={{ margin: 0, fontWeight: 600 }}>Saved, but worth checking:</p>
          <ul style={overrideList}>
            {assignWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {orphanError && (
        <p role="status" style={saveErrorStyle}>
          {orphanError}
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
/**
 * One of the two hour figures. Both are always on screen in the same order;
 * `big` is the only thing the mode toggle changes, so the admin's eye keeps the
 * place it had. Big shows the figure with its status beside it, mini collapses
 * to a single quiet line, and `judged` is what lets a verdict keep its colour in
 * either form while an ordinary status stays grey.
 */
function Readout({
  big,
  accent,
  judged,
  status,
  mini,
  children,
}: {
  big: boolean;
  accent: string;
  judged: boolean;
  status: React.ReactNode;
  mini: string;
  /** The figure itself, since the preferred one can be a two-tone range. */
  children: React.ReactNode;
}) {
  if (!big) {
    return <div style={judged ? { ...miniReadout, color: accent } : miniReadout}>{mini}</div>;
  }
  return (
    <div style={readoutGroup}>
      <div style={{ ...bigFigure, color: accent }}>{children}</div>
      <div style={{ ...statusLine, color: judged ? accent : "var(--color-text-secondary)" }}>
        {status}
      </div>
    </div>
  );
}

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
  trial,
  busyCell,
  split,
  isInternal,
  studentKeys,
  onToggle,
  orphans,
  onRemoveOrphan,
}: {
  sub: AdminSubGrid;
  mode: Mode;
  mock: Set<string>;
  preferred: Set<string>;
  auto: Set<string>;
  /** What the run holds now. */
  assigned: Map<string, AssignmentSource>;
  /** What the schedule trial holds; the schedule half renders from it in schedule mode. */
  trial: Set<string>;
  busyCell: string | null;
  split: boolean;
  isInternal: boolean;
  studentKeys: Set<string> | null;
  onToggle: (blockId: string, day: Day) => void;
  orphans: OrphanedCell[];
  onRemoveOrphan: (blockId: string, day: Day) => void;
}) {
  // One row per removed shift this day-type had, holding every day it was
  // picked on. Grouped here so the table stays the only place that knows how a
  // sub-grid is laid out.
  const orphanRows = useMemo(() => {
    const byBlock = new Map<
      string,
      { label: string; start: number; days: Set<Day>; retired: boolean }
    >();
    for (const c of orphans) {
      if (c.dayType !== sub.dayType) continue;
      const entry = byBlock.get(c.blockId) ?? {
        label: `${formatTime(c.start)}–${formatTime(c.end)}`,
        start: c.start,
        days: new Set<Day>(),
        // Two different stories with the same shape: the admin retired this
        // shift, or the student moved position and it belongs to the one they
        // left. Both are dead picks; only one of them was "removed".
        retired: c.retired,
      };
      entry.days.add(c.day);
      byBlock.set(c.blockId, entry);
    }
    return [...byBlock.entries()]
      .map(([blockId, v]) => ({ blockId, ...v }))
      .sort((a, b) => a.start - b.start);
  }, [orphans, sub.dayType]);

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
              // Diff cues against the student's own cells (internal copy only).
              // Live against the trial, so re-adding a dropped cell clears its ring.
              const inStudent = studentKeys ? studentKeys.has(key) : null;
              const notOffered =
                inMock && (inStudent === null ? !wasPreferred && !wasAuto : !inStudent);
              const removedFromStudent = inStudent === true && !inMock;
              const persisted = assigned.get(key) ?? null;
              // In schedule mode the half renders the TRIAL: a pending add takes
              // the manual violet, a pending removal empties the half.
              const inTrial = trial.has(key);
              const schedMode = mode === "schedule";
              const source = schedMode ? (inTrial ? (persisted ?? "manual") : null) : persisted;
              const pendingAdd = schedMode && inTrial && persisted === null;
              const pendingRemove = schedMode && !inTrial && persisted !== null;
              const isHot = row.highDemandDays[i] ?? false;
              const pressed = schedMode ? inTrial : inMock;
              return (
                <td key={day} style={{ padding: 0, ...weekSplit(sub, day) }}>
                  <button
                    type="button"
                    aria-pressed={pressed}
                    aria-label={`${row.label} ${DAY_LABEL[day]}`}
                    title={cellTitle(
                      mode,
                      inMock,
                      wasPreferred,
                      wasAuto,
                      source,
                      isHot,
                      isInternal,
                      notOffered,
                      removedFromStudent,
                      pendingAdd,
                      pendingRemove,
                    )}
                    onClick={() => onToggle(row.block.id, day)}
                    style={cellStyle(
                      inMock,
                      wasPreferred,
                      wasAuto,
                      source,
                      busyCell === key,
                      split,
                      notOffered,
                      removedFromStudent,
                      pendingAdd || pendingRemove,
                    )}
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
        {/* Dead shifts: retired by an admin, or on the position the student
            used to hold. The row is dead either way: every cell is disabled,
            and only a cell the student actually picked is clickable, to clear
            it. */}
        {orphanRows.map((row) => {
          const what = row.retired ? "removed" : "old position";
          const why = row.retired
            ? "This shift was removed."
            : "This shift is on the position they used to hold.";
          return (
          <tr key={row.blockId}>
            <td style={orphanLabel}>
              <span style={{ textDecoration: "line-through" }}>{row.label}</span>{" "}
              <span style={orphanTag}>{what}</span>
            </td>
            {sub.days.map((day) => {
              const picked = row.days.has(day);
              const key = selectionKey(row.blockId, day);
              return (
                <td key={day} style={{ padding: 0, ...weekSplit(sub, day) }}>
                  <button
                    type="button"
                    aria-label={`${row.label} ${DAY_LABEL[day]} on a ${what} shift`}
                    disabled={!picked || busyCell === key}
                    title={
                      picked
                        ? `${why} Click to clear this pick.`
                        : `${why} It can't be picked.`
                    }
                    onClick={() => onRemoveOrphan(row.blockId, day)}
                    style={orphanCellStyle(picked, busyCell === key)}
                  >
                    {picked && (
                      <span aria-hidden style={orphanTick}>
                        ✓
                      </span>
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * A cell on a dead shift (retired, or on the position the student left). A
 * picked one keeps the check mark so it still reads as the student's answer,
 * but greyed and hatched so it never looks like something the scheduler can
 * use; an unpicked one is inert.
 */
function orphanCellStyle(picked: boolean, busy: boolean): React.CSSProperties {
  return {
    width: CELL,
    height: CELL,
    padding: 0,
    borderRadius: 4,
    position: "relative",
    border: picked
      ? "1px solid var(--color-text-danger)"
      : "1px dashed var(--color-border-secondary)",
    background: picked
      ? "repeating-linear-gradient(45deg, #d9d9d9, #d9d9d9 3px, #ececec 3px, #ececec 6px)"
      : "var(--color-background-secondary)",
    opacity: busy ? 0.5 : picked ? 1 : 0.45,
    cursor: picked ? "pointer" : "not-allowed",
    boxSizing: "border-box",
  };
}

/** The live cells' white tick would vanish on the grey hatch; this reads on it. */
const orphanTick: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--color-text-danger)",
  pointerEvents: "none",
};

const orphanLabel: React.CSSProperties = {
  whiteSpace: "nowrap",
  color: "var(--color-text-tertiary)",
};

const orphanTag: React.CSSProperties = {
  borderRadius: 8,
  padding: "0 5px",
  fontSize: 10,
  background: "#fdecec",
  color: "var(--color-text-danger)",
  whiteSpace: "nowrap",
};

function cellTitle(
  mode: Mode,
  inMock: boolean,
  wasPreferred: boolean,
  wasAuto: boolean,
  source: AssignmentSource | null,
  isHot: boolean,
  isInternal: boolean,
  notOffered: boolean,
  removedFromStudent: boolean,
  pendingAdd: boolean,
  pendingRemove: boolean,
): string {
  // With an internal copy loaded the saved picks are the admin's, so the
  // tooltips stop attributing them to the student.
  const pickedLabel = isInternal ? "in the saved internal copy" : "the student picked this";
  const notPickedLabel = isInternal
    ? "not in the saved internal copy"
    : "not one the student picked";
  const parts: string[] = [];
  if (mode === "schedule") {
    if (pendingAdd) parts.push("Pending: added on Save. Click to undo.");
    else if (pendingRemove) parts.push("Pending: removed on Save. Click to undo.");
    else if (source === "manual") parts.push("Scheduled by hand. Click to remove.");
    else if (source === "engine") parts.push("Scheduled. Click to remove.");
    else parts.push("Click to schedule this shift.");
    if (wasPreferred || wasAuto) parts.push(wasAuto ? "auto-assigned weekend" : pickedLabel);
    else parts.push(notPickedLabel);
  } else {
    if (inMock)
      parts.push(
        notOffered ? "In trial schedule (not one the student picked)" : "In trial schedule",
      );
    else if (removedFromStudent)
      parts.push(
        wasPreferred
          ? "Student picked this; in the saved copy but not the trial schedule"
          : "Student picked this; not in the saved copy. Click to add it back.",
      );
    else if (wasPreferred)
      parts.push(
        isInternal
          ? "In the saved internal copy; not in the trial schedule"
          : "Student picked this; not in the trial schedule",
      );
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

function Legend({
  split,
  showDiff,
  showPending,
}: {
  split: boolean;
  showDiff: boolean;
  /** Schedule mode only: the ring that means "not saved yet". */
  showPending: boolean;
}) {
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
        {showDiff && (
          <>
            <span>
              <span style={ringSwatch("1.5px dashed var(--color-border-warning)")} /> not picked by
              the student
            </span>
            <span>
              <span style={ringSwatch(`1.5px dotted ${PREF_PICKED_COLOR}`)} /> their pick, not in
              this copy
            </span>
          </>
        )}
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
        {showPending && (
          <span>
            <span style={ringSwatch("1.5px dashed var(--color-border-warning)")} /> pending change
          </span>
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
/**
 * The readout line, hard against the title: the mode's own figure first, the
 * other one as a miniature after it. The wider gap between the two readouts
 * than inside either keeps them reading as two things and not one long number.
 */
const badge: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 14,
  marginTop: 2,
  flexWrap: "wrap",
};
/** One readout: its figure and its status line, side by side. */
const readoutGroup: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
};
const bigFigure: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  lineHeight: 1,
};
const statusLine: React.CSSProperties = {
  fontSize: 11,
  whiteSpace: "nowrap",
};
/**
 * The figure the current mode is NOT about. Small, quiet, and always carrying
 * its own noun ("scheduled", "preferred"), since the only thing worse than two
 * hour figures is two hour figures nobody can tell apart.
 */
const miniReadout: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  color: "var(--color-text-secondary)",
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
const laborNotePanel: React.CSSProperties = {
  marginTop: 10,
  padding: "8px 10px",
  fontSize: 12,
  background: "var(--color-background-secondary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  color: "var(--color-text-secondary)",
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
  top: 0,
  bottom: 0,
  right: 0,
  width: 3,
  background: "var(--color-text-danger)",
  borderRadius: "0 4px 4px 0",
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
/** A legend swatch for a diff ring: empty fill, the cue lives in the border. */
const ringSwatch = (border: string): React.CSSProperties => ({
  ...swatch,
  background: EMPTY_COLOR,
  border,
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

/**
 * Which of the two rotation weeks a student's weekend shifts fall in, offered
 * only in schedule mode and only while the schedule is alternating (under every
 * weekend they work both, so there is nothing to pick). Shaped like the Edit
 * mode toggle above rather than the pill beside it: it is a two-way choice, not
 * something that flips.
 */
const weekGroup: React.CSSProperties = {
  display: "inline-flex",
  marginLeft: 5,
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  overflow: "hidden",
  verticalAlign: "middle",
};
const weekBtn = (active: boolean): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "inherit",
  lineHeight: 1.6,
  padding: "1px 8px",
  border: "none",
  cursor: "pointer",
  background: active ? "var(--color-text-info)" : "var(--color-background-primary)",
  color: active ? "#fff" : "var(--color-text-secondary)",
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
  notOffered: boolean,
  removedFromStudent: boolean,
  pendingChange: boolean,
): React.CSSProperties {
  const pref = prefFill(inMock, wasPreferred, wasAuto);
  // A cell the student never offered, now in the trial, gets an amber dashed
  // ring; a student cell missing from the trial (dropped by the internal copy,
  // or just unchecked) gets a blue dotted one. An unsaved schedule change is
  // the same "deviates" cue and takes precedence, since in schedule mode that
  // is the thing the admin is tracking.
  const border =
    pendingChange || notOffered
      ? "1.5px dashed var(--color-border-warning)"
      : removedFromStudent
        ? `1.5px dotted ${PREF_PICKED_COLOR}`
        : "1px solid var(--color-border-tertiary)";
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
    border,
    opacity: busy ? 0.5 : 1,
  };
}
