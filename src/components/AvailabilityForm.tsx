"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GridModel, SubGrid } from "@/lib/availability/grid";
import {
  selectionKey,
  keysToSelection,
  selectionToKeys,
  computeCoveredKeys,
} from "@/lib/availability/selection";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { hourCap } from "@/lib/domain/caps";
import {
  DAY_LABEL,
  type Day,
  type Position,
  type SelectedShift,
  type ShiftBlock,
} from "@/lib/domain/types";
import { saveAvailability } from "@/lib/availability/actions";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCircleCheck,
  faFire,
  faMinus,
  faStar,
  faTriangleExclamation,
} from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { faCircle } from "@awesome.me/kit-925f6dce39/icons/classic/regular";
import {
  ActionBar,
  Button,
  Card,
  Notice,
  Pill,
  StatusLine,
  VisuallyHidden,
} from "@/components/student/ui";
import { useUnsavedChangesWarning } from "@/components/useUnsavedChangesWarning";

/** The user-editable fields, snapshotted at load/save to detect unsaved edits. */
interface FormSnapshot {
  selectedKeys: Set<string>;
  optIn: boolean;
  desired: string;
  notes: string;
}

function sameKeySet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

interface RequirementItem {
  key: string;
  passed: boolean;
  severity: "hard" | "soft";
  label: string;
}

export interface AvailabilityFormProps {
  position: Position;
  blocks: ShiftBlock[];
  gridModel: GridModel;
  /** Drives the "Max" desired-hours shortcut (20h international vs 30h domestic). */
  international: boolean;
  initialSelection: { blockId: string; day: Day }[];
  /** Weekend cell(s) the server auto-assigned on a prior submit (PLAN §5 #5). */
  initialAutoAssigned: SelectedShift[];
  initialEveryWeekendOptIn: boolean;
  initialDesiredHours: number | null;
  initialNotes: string;
  initialStatus: "draft" | "submitted" | null;
  /** Admin inspection mode: live validation works, but nothing is persisted. */
  preview?: boolean;
  /** When false, the form is read-only (window closed or not yet open, PLAN §13). */
  editable?: boolean;
}

export function AvailabilityForm(props: AvailabilityFormProps) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    selectionToKeys(props.initialSelection),
  );
  const [autoAssigned, setAutoAssigned] = useState<Set<string>>(() =>
    selectionToKeys(props.initialAutoAssigned),
  );
  const [optIn, setOptIn] = useState(props.initialEveryWeekendOptIn);
  const [desired, setDesired] = useState(props.initialDesiredHours?.toString() ?? "");
  const [notes, setNotes] = useState(props.initialNotes);
  const [message, setMessage] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [saved, setSaved] = useState<FormSnapshot>(() => ({
    selectedKeys: selectionToKeys(props.initialSelection),
    optIn: props.initialEveryWeekendOptIn,
    desired: props.initialDesiredHours?.toString() ?? "",
    notes: props.initialNotes,
  }));
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const editable = props.editable ?? true;
  // A submitted form is edited in place ("Save changes"); an unsubmitted one is
  // the wizard step ("Save draft" + "Save and continue → /travel").
  const editMode = props.initialStatus === "submitted";

  // Only surface the high-demand legend when at least one cell is actually flagged,
  // so it never references a mark the student can't see.
  const anyHighDemand =
    props.gridModel.weekday.rows.some((r) => r.highDemandDays.some(Boolean)) ||
    (props.gridModel.weekend?.rows.some((r) => r.highDemandDays.some(Boolean)) ?? false);

  const dirty =
    editable &&
    !props.preview &&
    (!sameKeySet(selected, saved.selectedKeys) ||
      optIn !== saved.optIn ||
      desired !== saved.desired ||
      notes !== saved.notes);
  useUnsavedChangesWarning(dirty);

  // Only consider cells that belong to this position's blocks, so stale state
  // (e.g. switching previews) can never reference an unknown block.
  const validIds = useMemo(() => new Set(props.blocks.map((b) => b.id)), [props.blocks]);
  const selection = useMemo(
    () => keysToSelection(selected).filter((s) => validIds.has(s.blockId)),
    [selected, validIds],
  );

  const validation = useMemo(
    () =>
      validateAvailability(selection, props.position, props.blocks, { everyWeekendOptIn: optIn }),
    [selection, optIn, props.position, props.blocks],
  );
  const coveredKeys = useMemo(
    () => computeCoveredKeys(selection, props.blocks),
    [selection, props.blocks],
  );

  const desiredHours = desired === "" ? null : Number(desired);
  const desiredCheck = checkDesiredHours(desiredHours, props.position);
  const canSubmit = validation.canSubmit && desiredCheck.passed;

  const minHours = props.position.minHours;
  const maxHours = hourCap(props.international);

  const requirements: RequirementItem[] = [...validation.checks, desiredCheck].map((c) => ({
    key: c.id,
    passed: c.passed,
    severity: c.severity,
    label: c.detail,
  }));

  function toggle(blockId: string, day: Day) {
    if (!editable) return;
    setMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      const key = selectionKey(blockId, day);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function run(mode: "draft" | "continue", advanceTo?: string) {
    if (props.preview) {
      setMessage({
        ok: true,
        lines: [
          `Preview mode: nothing saved (would ${
            mode === "continue" ? "save and continue" : "save a draft"
          }).`,
        ],
      });
      return;
    }
    startTransition(async () => {
      const res = await saveAvailability({
        selection,
        everyWeekendOptIn: optIn,
        desiredHours,
        notes,
        mode,
      });
      if (res.ok) {
        // Everything the server accepted is now the saved baseline.
        setSaved({ selectedKeys: selected, optIn, desired, notes });
        // The server owns auto-assignment; mirror its decision in the grid.
        setAutoAssigned(
          res.autoAssigned
            ? new Set([selectionKey(res.autoAssigned.blockId, res.autoAssigned.day)])
            : new Set(),
        );
        if (advanceTo) {
          router.push(advanceTo);
          return; // leaving the page, no need to set a message
        }
      }
      setMessage({
        ok: res.ok,
        lines: res.ok
          ? [
              mode === "draft"
                ? "Draft saved."
                : res.autoAssigned
                  ? `Saved. You didn't pick a weekend shift, so we kept one for you: ${res.autoAssigned.label}.`
                  : "Saved.",
            ]
          : res.errors,
      });
    });
  }

  // What is still unmet, for the action bar and for screen readers. Soft checks
  // never block, so they are not counted.
  const todo = requirements.filter((r) => !r.passed && r.severity === "hard").length;
  const todoText =
    todo === 0
      ? "All requirements met"
      : `${todo} ${todo === 1 ? "requirement" : "requirements"} left`;
  // Spoken a moment after the last change, so ticking several cells in a row
  // is announced once. It starts filled in, so loading the page says nothing.
  const [announced, setAnnounced] = useState(todoText);
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(todoText), 800);
    return () => clearTimeout(t);
  }, [todoText]);

  // Continuing with requirements unmet takes the student to the list of what is
  // left, instead of a dead button that gives no reason.
  const requirementsRef = useRef<HTMLElement>(null);
  const [flagged, setFlagged] = useState(false);
  function continueOrExplain(advanceTo?: string) {
    if (!canSubmit) {
      setFlagged(true);
      requirementsRef.current?.focus();
      return;
    }
    run("continue", advanceTo);
  }

  const states = new Set<CellState>();
  for (const sub of [props.gridModel.weekday, props.gridModel.weekend]) {
    for (const row of sub?.rows ?? []) {
      for (const day of sub!.days) {
        states.add(cellState(selectionKey(row.block.id, day), selected, autoAssigned, coveredKeys));
      }
    }
  }

  return (
    <>
      {props.preview && (
        <Notice tone="warning" role="note" title="Admin preview">
          <p>
            This is the student view of the {props.position.name} form. Toggling cells exercises
            live validation, but nothing is saved.
          </p>
        </Notice>
      )}

      <div className="sf-cluster">
        <h1>Your availability</h1>
        {props.initialStatus === "submitted" && <Pill tone="success">Submitted</Pill>}
      </div>
      <p className="sf-muted">Position: {props.position.name}</p>
      <p className="sf-muted">
        Check every shift you&apos;d be willing to work. This is your <strong>availability</strong>,
        not your final schedule.{" "}
        <strong>You must meet the minimum policy requirements to submit.</strong> If you do not
        submit your availability, we will assign you a schedule based on your course schedule only.
      </p>

      <ul className="sf-legend" aria-label="What the marks mean">
        <li>
          <LegendCell state="on" /> Your pick
        </li>
        {states.has("covered") && (
          <li>
            <LegendCell state="covered" /> Covered by a longer shift you picked
          </li>
        )}
        {states.has("auto") && (
          <li>
            <LegendCell state="auto" /> Picked for you
          </li>
        )}
        {anyHighDemand && (
          <li>
            <span className="sf-cell-hot" aria-hidden>
              <FontAwesomeIcon icon={faFire} />
            </span>{" "}
            A lot of students picked this shift. Choosing less busy shifts can help you get the
            hours you want.
          </li>
        )}
      </ul>

      <div
        className={
          props.gridModel.weekend ? "sf-avail-grids sf-avail-grids--two" : "sf-avail-grids"
        }
      >
        <Card>
          <Grid
            sub={props.gridModel.weekday}
            selected={selected}
            covered={coveredKeys}
            autoAssigned={autoAssigned}
            onToggle={toggle}
            editable={editable}
          />
        </Card>

        {props.gridModel.weekend && (
          <Card>
            <Grid
              sub={props.gridModel.weekend}
              selected={selected}
              covered={coveredKeys}
              autoAssigned={autoAssigned}
              onToggle={toggle}
              editable={editable}
            />
            <p className="sf-small sf-gap-top">
              You&apos;ll be placed on an <strong>A/B weekend rotation</strong> (a weekend shift
              every other weekend).
            </p>
            <label className="sf-check">
              <input
                type="checkbox"
                checked={optIn}
                disabled={!editable}
                onChange={(e) => setOptIn(e.target.checked)}
              />
              <span>
                I&apos;d rather work <strong>every</strong> weekend (in exchange for fewer weekday
                shifts).
              </span>
            </label>
          </Card>
        )}
      </div>

      <Card>
        <div className="sf-field">
          <label htmlFor="desired-hours" className="sf-label">
            Desired weekly hours
          </label>
          <div className="sf-hours">
            <input
              id="desired-hours"
              className="sf-input sf-num"
              type="number"
              inputMode="numeric"
              min={minHours}
              required
              aria-describedby="desired-hours-hint"
              value={desired}
              disabled={!editable}
              onChange={(e) => setDesired(e.target.value)}
            />
            {editable && (
              <>
                <Button variant="secondary" small onClick={() => setDesired(String(minHours))}>
                  Min ({minHours}h)
                </Button>
                <Button variant="secondary" small onClick={() => setDesired(String(maxHours))}>
                  Max ({maxHours}h)
                </Button>
              </>
            )}
          </div>
          <p id="desired-hours-hint" className="sf-hint">
            International students are limited to a maximum of 20 hours/week. Domestic students are
            limited to 30 hours/week.
          </p>
        </div>
      </Card>

      <Card>
        <div className="sf-field">
          <label htmlFor="schedule-notes" className="sf-label">
            Anything we should know about your schedule?{" "}
            <span className="sf-optional">(optional)</span>
          </label>
          <textarea
            id="schedule-notes"
            className="sf-textarea"
            value={notes}
            readOnly={!editable}
            onChange={(e) => {
              setNotes(e.target.value);
              setMessage(null);
            }}
            rows={3}
            placeholder="e.g. I prefer mornings, or I can close on Fridays"
          />
        </div>
      </Card>

      <section
        id="requirements"
        ref={requirementsRef}
        tabIndex={-1}
        className="sf-card sf-anchor"
        aria-labelledby="requirements-title"
      >
        <h2 id="requirements-title">Requirements</h2>
        <p className="sf-muted sf-small sf-num">
          {validation.capacity.weeklyAverageHours.toFixed(1)}h available · {validation.daysCovered}{" "}
          {validation.daysCovered === 1 ? "day" : "days"} selected
        </p>
        <ul className={flagged ? "sf-checklist sf-checklist--flagged" : "sf-checklist"}>
          {requirements.map((c) => {
            const kind = c.passed ? "passed" : c.severity === "hard" ? "todo" : "soft";
            return (
              <li key={c.key} className={`sf-check--${kind}`}>
                <FontAwesomeIcon icon={CHECK_ICON[kind]} aria-hidden />
                <span>
                  <VisuallyHidden>{CHECK_WORD[kind]}: </VisuallyHidden>
                  {c.label}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <div role="status">
        <VisuallyHidden>{announced}</VisuallyHidden>
      </div>

      {editable ? (
        <ActionBar
          status={
            message ? (
              <StatusLine ok={message.ok} role={message.ok ? "status" : "alert"}>
                {message.lines.length === 1 ? (
                  message.lines[0]
                ) : (
                  <ul className="sf-list">
                    {message.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </StatusLine>
            ) : (
              <a href="#requirements" className="sf-num">
                {todoText}
              </a>
            )
          }
        >
          {!editMode && (
            <Button
              variant="secondary"
              onClick={() => run("draft")}
              pending={pending}
              pendingLabel="Saving…"
            >
              Save draft
            </Button>
          )}
          <Button
            onClick={() => continueOrExplain(editMode ? undefined : "/travel")}
            pending={pending}
            pendingLabel="Saving…"
            aria-disabled={!canSubmit}
            aria-describedby="requirements-title"
          >
            {editMode ? "Save changes" : "Save and continue"}
          </Button>
        </ActionBar>
      ) : (
        <p className="sf-muted">Read-only. Your form window isn&apos;t open for edits right now.</p>
      )}
    </>
  );
}

type CellState = "on" | "auto" | "covered" | "off";

function cellState(
  key: string,
  selected: Set<string>,
  autoAssigned: Set<string>,
  covered: Set<string>,
): CellState {
  return selected.has(key)
    ? "on"
    : autoAssigned.has(key)
      ? "auto"
      : covered.has(key)
        ? "covered"
        : "off";
}

const CELL_ICON = { on: faCheck, auto: faStar, covered: faMinus, off: faCheck } as const;
/** Appended to a cell's name, so its state reaches a screen reader and not only the eye. */
const CELL_STATE_NAME = {
  on: "",
  off: "",
  auto: ", picked for you",
  covered: ", covered by a longer shift you picked",
} as const;

const CHECK_ICON = { passed: faCircleCheck, todo: faCircle, soft: faTriangleExclamation } as const;
const CHECK_WORD = { passed: "Done", todo: "To do", soft: "Note" } as const;

/** A small, inert copy of a cell for the legend. */
function LegendCell({ state }: { state: CellState }) {
  return (
    <span className={`sf-cell sf-cell--${state}`} aria-hidden>
      <FontAwesomeIcon icon={CELL_ICON[state]} />
    </span>
  );
}

function Grid({
  sub,
  selected,
  covered,
  autoAssigned,
  onToggle,
  editable,
}: {
  sub: SubGrid;
  selected: Set<string>;
  covered: Set<string>;
  autoAssigned: Set<string>;
  onToggle: (blockId: string, day: Day) => void;
  editable: boolean;
}) {
  const heading = sub.dayType === "weekday" ? "Weekdays" : "Weekend";
  const headingId = `grid-${sub.dayType}`;
  // The weekend variant splits the Sun and Sat columns with a rule (PLAN §7):
  // the scheduling week starts on Sunday, so the two days sit at opposite ends
  // of the week, not side by side.
  const variants =
    (sub.dayType === "weekend" ? " sf-grid--weekend" : "") + (editable ? "" : " sf-grid--locked");
  return (
    <>
      <h2 id={headingId}>{heading}</h2>
      <table className={`sf-grid${variants}`} aria-labelledby={headingId}>
        <thead>
          <tr>
            <td />
            {sub.days.map((d) => (
              <th key={d} scope="col">
                {DAY_LABEL[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sub.rows.map((row) => (
            <tr key={row.block.id}>
              <th scope="row" className="sf-grid-rowlabel">
                {row.label}
                {row.isOpen && <span className="sf-grid-tag">Opening</span>}
                {row.isClose && <span className="sf-grid-tag">Closing</span>}
              </th>
              {sub.days.map((day, di) => {
                const state = cellState(
                  selectionKey(row.block.id, day),
                  selected,
                  autoAssigned,
                  covered,
                );
                const isHot = row.highDemandDays[di];
                return (
                  <td key={day}>
                    <button
                      type="button"
                      className={`sf-cell sf-cell--${state}`}
                      aria-pressed={state === "on"}
                      aria-label={`${row.label} ${DAY_LABEL[day]}${CELL_STATE_NAME[state]}${
                        isHot ? ", busy shift" : ""
                      }`}
                      aria-disabled={!editable}
                      onClick={() => onToggle(row.block.id, day)}
                    >
                      {isHot && (
                        <span aria-hidden className="sf-cell-hot">
                          <FontAwesomeIcon icon={faFire} />
                        </span>
                      )}
                      <FontAwesomeIcon icon={CELL_ICON[state]} aria-hidden />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
