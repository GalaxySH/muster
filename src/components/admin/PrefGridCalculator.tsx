"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import type { AdminGridModel, AdminSubGrid } from "@/lib/admin/summary";
import { computeCapacity } from "@/lib/domain/capacity";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { keysToSelection, selectionKey } from "@/lib/availability/selection";
import { saveAvailabilityFor } from "@/lib/availability/actions";
import { removeOrphanedSelection } from "@/lib/admin/actions";
import type { OrphanedCell } from "@/lib/positions/orphans";
import { applyScheduleEdits } from "@/lib/schedule/manual";
import { Button, Disclosure, Notice, Pill, cx } from "@/components/admin/ui";
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
 * Once there is a schedule run every cell is split: an inner square is the
 * student's availability preference, the outer square the current run's
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
 * engine row is allowed. Disabled until a run exists. Once one does, it is the
 * tab the card opens on; without one the card opens on Edit preferences.
 *
 * The weekend header's rotation control belongs to whichever mode is on (1.24),
 * because the two modes ask different questions of it. In preferences it is the
 * student's own answer, re-weighting the preferred hours. In schedule it is the
 * RUN's rotation, read off their current-run rows: flipping it moves every
 * weekend row they hold, and while the plan is alternating an A/B pair beside it
 * picks the week. It rides the same trial as the cells, so Save carries it in
 * the same batch and Reset drops it with them. Preferences also shows a quiet
 * read-only chip beside its pill naming the week the saved schedule puts them
 * on, so the admin can compare the two without switching tabs.
 *
 * The header carries BOTH hour figures at once, because the question the admin
 * is asking changes with the mode and the other number is still worth a glance:
 * the trial's preferred hours and the run's scheduled hours. Whichever the
 * current mode is about takes the full size and the status line, the other
 * shrinks to a labelled miniature beside it, so the two can never be mistaken
 * for each other.
 */

/** The colour a readout takes; each is a class in app/admin-grid.css. */
type ReadoutTone = "info" | "muted" | "warning" | "danger";

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
  // Opens on the schedule when there is one to edit. Every other piece of state
  // is seeded the same way in both modes, so the starting tab changes nothing
  // but which one is showing.
  const [mode, setMode] = useState<Mode>(props.hasCurrentRun ? "schedule" : "prefs");
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
  const termId = useRenderedTermId();
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
      const res = await removeOrphanedSelection(props.studentEmail, blockId, day, termId);
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
      const res = await saveAvailabilityFor(
        props.studentEmail,
        {
          selection,
          everyWeekendOptIn: optIn,
          overrideInvalid: override,
        },
        termId,
      );
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
          termId,
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
        : "available";
  const tone: ReadoutTone = belowFloor ? "warning" : "info";

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
  const scheduledTone: ReadoutTone = scheduledOverCap
    ? "danger"
    : scheduledBelowFloor
      ? "warning"
      : scheduledHours === 0
        ? "muted"
        : "info";
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
    ? `${fmtNum(hours)}–${fmtHours(hoursWithAuto)} available`
    : `${fmtHours(hours)} available`;
  // Schedule mode without a run cannot happen (the button is disabled), but the
  // fallback keeps the preferred readout big rather than rendering nothing.
  const scheduleIsBig = mode === "schedule" && scheduledHours !== null;

  return (
    <div className="ad-gr">
      {/* Header: title + the mode toggle share the top line; the hours readout gets
          its own line so a wider or narrower number can't shuffle the layout as the
          admin clicks. The Reset/Clear controls sit with the legend. */}
      <div className="ad-gr-head">
        <h2 className="ad-panel-title">Availability and schedule</h2>
        <div role="group" aria-label="Edit mode" className="ad-seg ad-gr-mode">
          <button type="button" aria-pressed={mode === "prefs"} onClick={() => switchMode("prefs")}>
            Edit preferences
          </button>
          <button
            type="button"
            aria-pressed={mode === "schedule"}
            disabled={!props.hasCurrentRun}
            onClick={() => switchMode("schedule")}
          >
            Edit schedule
          </button>
        </div>
      </div>
      {!props.hasCurrentRun && (
        <p className="ad-help">Generate a schedule first on the schedule page.</p>
      )}
      {mode === "schedule" && (
        <p className="ad-help">
          Updating the schedule can replace these shifts unless the student is marked scheduled.
        </p>
      )}
      {/* Preferred always first, scheduled always second, whichever mode is on.
          Switching modes only moves the emphasis between them: a figure that
          jumped sides as well would have to be re-found on every click. */}
      <div className="ad-gr-readouts" aria-live="polite">
        <Readout
          big={!scheduleIsBig}
          tone={tone}
          judged={belowFloor}
          status={
            <>
              {statusText}
              {mock.size > 0 && !belowFloor && (
                <span className="ad-faint">
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
                className="ad-gr-auto-text"
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
            tone={scheduledTone}
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

      <div className="ad-gr-grids">
        <div className="ad-gr-sub">
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
          <div className="ad-gr-sub">
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
                    className={rotationPillClass(rotationMoves)}
                    title={
                      schedCohort === "every"
                        ? "They work both weeks. Click to put them on one."
                        : "They work every other week. Click to put them on both."
                    }
                  >
                    {schedCohort === "every" ? "EVERY weekend" : "alternating (A/B)"}
                  </button>
                  {schedCohort !== "every" && (
                    <span role="group" aria-label="Rotation week" className="ad-seg">
                      {(["a", "b"] as const).map((week) => (
                        <button
                          key={week}
                          type="button"
                          aria-pressed={schedCohort === week}
                          onClick={() => setRotationWeek(week)}
                          title={`Put their weekend shifts in week ${week.toUpperCase()}`}
                        >
                          {week.toUpperCase()}
                        </button>
                      ))}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-pressed={optIn}
                    onClick={flipRotation}
                    className={rotationPillClass(rotationDeviates)}
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
                  {/* The saved schedule's week, for reference only: it reads the
                      run as persisted, never an unsaved schedule trial. */}
                  {props.scheduleCohort && (
                    <span
                      role="note"
                      aria-label={SCHEDULED_WEEK[props.scheduleCohort].label}
                      title={SCHEDULED_WEEK[props.scheduleCohort].label}
                      className="ad-gr-week-note"
                    >
                      Sched <b>{SCHEDULED_WEEK[props.scheduleCohort].letter}</b>
                    </span>
                  )}
                </>
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

      <div className="ad-gr-foot">
        <div className="ad-gr-legend-wrap">
          <Disclosure title="Legend" panel={false}>
            <Legend
              split={split}
              showDiff={studentKeys !== null}
              showPending={mode === "schedule"}
            />
          </Disclosure>
        </div>
        {mode === "prefs" ? (
          <div className="ad-gr-controls">
            {dirty && (
              <Button onClick={reset} title="Reset to the saved picks">
                Reset
              </Button>
            )}
            <Button onClick={clear} title="Clear every cell">
              Clear
            </Button>
            {showSave && (
              <Button
                variant={saving || saved ? "secondary" : "primary"}
                className={saved ? "ad-gr-saved" : undefined}
                onClick={save}
                disabled={saving || saved}
                title={
                  saved
                    ? "Saved as the internal copy used for scheduling"
                    : "Save as the internal copy used for scheduling. The student's own answers are kept."
                }
              >
                {saving ? "Saving…" : saved ? "Saved" : "Save"}
              </Button>
            )}
          </div>
        ) : (
          /* No Clear here: wiping a whole schedule should not be one click. */
          <div className="ad-gr-controls">
            {scheduleDirty && (
              <Button onClick={resetSchedule} title="Drop the pending changes">
                Reset
              </Button>
            )}
            {showSchedSave && (
              <Button
                variant={schedSaving || schedSaved ? "secondary" : "primary"}
                className={schedSaved ? "ad-gr-saved" : undefined}
                onClick={saveSchedule}
                disabled={schedSaving || schedSaved || busyCell !== null}
                title={
                  schedSaved
                    ? "Saved to the current schedule"
                    : "Write the pending changes to the current schedule"
                }
              >
                {schedSaving ? "Saving…" : schedSaved ? "Saved" : "Save"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The explicit "Save anyway" step: the trial fails hard checks, so the save
          waits until the admin has seen exactly which ones and accepts the flag. */}
      {overrideChecks && (
        <div className="ad-gr-block">
          <Notice tone="warning" role="status" title="This does not pass the availability checks:">
            <ul className="ad-gr-list">
              {overrideChecks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p>Saving anyway keeps shifts that fail these checks.</p>
            <div className="ad-row">
              <Button variant="danger-fill" onClick={() => doSave(true)}>
                Save anyway
              </Button>
              <Button onClick={() => setOverrideChecks(null)}>Keep editing</Button>
            </div>
          </Notice>
        </div>
      )}

      {saveError && (
        <p role="status" className="ad-error ad-gr-msg">
          {saveError}
        </p>
      )}
      {assignError && (
        <p role="status" className="ad-error ad-gr-msg">
          {assignError}
        </p>
      )}
      {/* Non-blocking labor notes on the week the save landed on: the shifts are
          placed, the admin decides. Deliberately quieter than the amber
          acknowledge panel, which blocks. */}
      {assignWarnings && (
        <div className="ad-gr-block">
          <Notice role="status" title="Saved, but worth checking:">
            <ul className="ad-gr-list">
              {assignWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      {orphanError && (
        <p role="status" className="ad-error ad-gr-msg">
          {orphanError}
        </p>
      )}
    </div>
  );
}

/**
 * One of the two hour figures. Both are always on screen in the same order;
 * `big` is the only thing the mode toggle changes, so the admin's eye keeps the
 * place it had. Big shows the figure with its status beside it, mini collapses
 * to a single quiet line, and `judged` is what lets a verdict keep its colour in
 * either form while an ordinary status stays grey.
 */
function Readout({
  big,
  tone,
  judged,
  status,
  mini,
  children,
}: {
  big: boolean;
  tone: ReadoutTone;
  judged: boolean;
  status: React.ReactNode;
  mini: string;
  /** The figure itself, since the preferred one can be a two-tone range. */
  children: React.ReactNode;
}) {
  const toneClass = `ad-gr-tone--${tone}`;
  if (!big) {
    return <div className={cx("ad-gr-mini", judged && toneClass)}>{mini}</div>;
  }
  return (
    <div className="ad-gr-readout">
      <div className={cx("ad-gr-figure", toneClass)}>{children}</div>
      <div className={cx("ad-gr-status", judged && toneClass)}>{status}</div>
    </div>
  );
}

/**
 * The scheduling week starts on Sunday, so Sun opens the week and Sat closes it
 * rather than the two forming one contiguous weekend (PLAN §7). A wider gap plus
 * a thin vertical rule between the two weekend columns makes that visible,
 * mirroring the split in the student grid (AvailabilityForm).
 */
function weekSplitClass(sub: AdminSubGrid, day: Day): string | false {
  if (sub.dayType !== "weekend") return false;
  return day === "sun" ? "ad-gr-sun" : "ad-gr-sat";
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
  /** What the schedule trial holds; the outer square renders from it in schedule mode. */
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
    <div className="ad-scroll-x ad-gr-scroll">
      <table className="ad-gr-table">
        <thead>
          <tr>
            <td />
            {sub.days.map((d) => (
              <th key={d} scope="col" className={cx("ad-gr-day", weekSplitClass(sub, d))}>
                {DAY_LABEL[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sub.rows.map((row) => (
            <tr key={row.block.id}>
              <th scope="row" className="ad-gr-label">
                {row.label} {row.isOpen && <span className="ad-gr-edge">open</span>}
                {row.isClose && <span className="ad-gr-edge">close</span>}
              </th>
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
                // In schedule mode the outer square renders the TRIAL: a pending add takes
                // the manual violet, a pending removal empties it.
                const inTrial = trial.has(key);
                const schedMode = mode === "schedule";
                const source = schedMode ? (inTrial ? (persisted ?? "manual") : null) : persisted;
                const pendingAdd = schedMode && inTrial && persisted === null;
                const pendingRemove = schedMode && !inTrial && persisted !== null;
                const isHot = row.highDemandDays[i] ?? false;
                const pressed = schedMode ? inTrial : inMock;
                return (
                  <td key={day} className={cx("ad-gr-td", weekSplitClass(sub, day))}>
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
                      className={cellClass(
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
                      {split && <span aria-hidden className="ad-gr-inner" />}
                      {isHot && <span aria-hidden className="ad-gr-hot" />}
                      {inMock && (
                        <span
                          aria-hidden
                          className={split ? "ad-gr-tick" : "ad-gr-tick ad-gr-tick--full"}
                        >
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
                <th scope="row" className="ad-gr-label ad-faint">
                  <span className="ad-struck">{row.label}</span> <Pill tone="danger">{what}</Pill>
                </th>
                {sub.days.map((day) => {
                  const picked = row.days.has(day);
                  const key = selectionKey(row.blockId, day);
                  return (
                    <td key={day} className={cx("ad-gr-td", weekSplitClass(sub, day))}>
                      {/* A picked one keeps the check mark so it still reads as
                          the student's answer, hatched so it never looks like
                          something the scheduler can use; an unpicked one is
                          inert. */}
                      <button
                        type="button"
                        aria-label={`${row.label} ${DAY_LABEL[day]} on a ${what} shift`}
                        disabled={!picked || busyCell === key}
                        title={
                          picked ? `${why} Click to clear this pick.` : `${why} It can't be picked.`
                        }
                        onClick={() => onRemoveOrphan(row.blockId, day)}
                        className={cx(
                          "ad-gr-orphan",
                          picked && "ad-gr-orphan--picked",
                          busyCell === key && "ad-gr-busy",
                        )}
                      >
                        {picked && (
                          <span aria-hidden className="ad-gr-orphan-tick">
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
    </div>
  );
}

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
  return <div className="ad-gr-subhead">{children}</div>;
}

/**
 * A legend swatch for a preference colour: the inner square when the cell is
 * split against a schedule, the whole swatch when there is no run to split against.
 */
function PrefSwatch({ pref, split }: { pref: "trial" | "picked" | "auto"; split: boolean }) {
  return (
    <span className={cx("ad-gr-swatch", `ad-gr-pref--${pref}`, split && "ad-gr-split")}>
      {split && <span className="ad-gr-inner" />}
    </span>
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
    <div className="ad-gr-legend">
      {/* The split only exists once there's a schedule run to compare against;
          without one the cells are whole preference squares. */}
      {split && <div>Inner square: their preference. Outer square: scheduled shift.</div>}
      <div className="ad-gr-legend-row">
        <span>
          <PrefSwatch pref="trial" split={split} /> in trial schedule
        </span>
        <span>
          <PrefSwatch pref="picked" split={split} /> picked, not in trial
        </span>
        <span>
          <PrefSwatch pref="auto" split={split} /> auto-assigned
        </span>
        {showDiff && (
          <>
            <span>
              <span className="ad-gr-swatch ad-gr-ring--deviates" /> not picked by the student
            </span>
            <span>
              <span className="ad-gr-swatch ad-gr-ring--dropped" /> their pick, not in this copy
            </span>
          </>
        )}
        {split && (
          <>
            <span>
              <span className="ad-gr-swatch ad-gr-split ad-gr-sched--engine">
                <span className="ad-gr-inner" />
              </span>{" "}
              scheduled
            </span>
            <span>
              <span className="ad-gr-swatch ad-gr-split ad-gr-sched--manual">
                <span className="ad-gr-inner" />
              </span>{" "}
              scheduled by hand
            </span>
          </>
        )}
        {showPending && (
          <span>
            <span className="ad-gr-swatch ad-gr-ring--deviates" /> pending change
          </span>
        )}
        <span>
          <span className="ad-gr-hot-swatch" /> high-demand
        </span>
      </div>
    </div>
  );
}

/**
 * The weekend rotation as a toggle: filled while it is every weekend, quiet
 * under A/B. Once flipped away from what is saved it takes the same dashed ring
 * the grid uses for a cell that deviates.
 */
const rotationPillClass = (deviates: boolean) => cx("ad-chip", deviates && "ad-gr-ring--deviates");

/**
 * The saved schedule's rotation week, shown beside the preference pill. It is
 * a label, not a control, so it is outlined and muted rather than shaped like
 * the pill it sits next to.
 */
const SCHEDULED_WEEK: Record<Exclude<Cohort, "weekday">, { letter: string; label: string }> = {
  a: { letter: "A", label: "Scheduled for week A" },
  b: { letter: "B", label: "Scheduled for week B" },
  every: { letter: "E", label: "Scheduled every weekend" },
};

/**
 * One cell's look, as classes (app/admin-grid.css). The preference fills the
 * inner square and the schedule the outer one once there is a schedule to
 * split against; with no run the preference fills the whole square.
 *
 * A cell the student never offered, now in the trial, gets a dashed ring; a
 * student cell missing from the trial (dropped by the internal copy, or just
 * unchecked) gets a dotted one. An unsaved schedule change is the same
 * "deviates" cue and takes precedence, since in schedule mode that is the
 * thing the admin is tracking.
 */
function cellClass(
  inMock: boolean,
  wasPreferred: boolean,
  wasAuto: boolean,
  source: AssignmentSource | null,
  busy: boolean,
  split: boolean,
  notOffered: boolean,
  removedFromStudent: boolean,
  pendingChange: boolean,
): string {
  const pref = inMock ? "trial" : wasPreferred ? "picked" : wasAuto ? "auto" : null;
  return cx(
    "ad-gr-cell",
    pref && `ad-gr-pref--${pref}`,
    split && "ad-gr-split",
    split && source && `ad-gr-sched--${source}`,
    pendingChange || notOffered
      ? "ad-gr-ring--deviates"
      : removedFromStudent && "ad-gr-ring--dropped",
    busy && "ad-gr-busy",
  );
}
