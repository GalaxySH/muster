"use client";

import { useMemo, useState, useTransition } from "react";
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
import type { Day, Position, SelectedShift, ShiftBlock } from "@/lib/domain/types";
import { saveAvailability } from "@/lib/availability/actions";
import { ActionButton } from "@/components/ui";
import { useUnsavedChangesWarning } from "@/components/useUnsavedChangesWarning";

const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
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
        text: `Preview mode: nothing saved (would ${
          mode === "continue" ? "save and continue" : "save a draft"
        }).`,
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
        text: res.ok
          ? mode === "draft"
            ? "Draft saved."
            : res.autoAssigned
              ? `Saved. You didn't pick a weekend shift, so we kept one for you: ${res.autoAssigned.label}.`
              : "Saved."
          : res.errors.join(" · "),
      });
    });
  }

  return (
    <div style={{ maxWidth: 980 }}>
      {props.preview && (
        <p
          role="note"
          style={{
            background: "#fff4d6",
            border: "1px solid #e0c060",
            borderRadius: 6,
            padding: "0.5rem 0.8rem",
            fontSize: 14,
          }}
        >
          <strong>Admin preview.</strong> This is the student view of the {props.position.name}{" "}
          form. Toggling cells exercises live validation, but nothing is saved.
        </p>
      )}

      <h1>Choose your availability preferences</h1>
      <p style={{ color: "#555" }}>Position: {props.position.name}</p>
      <p style={{ color: "#555" }}>
        Check every shift you&apos;d be willing to work. These are preferences, not your final schedule. <strong>You must meet the minimum policy requirements to submit.</strong> If you do not submit your availability, we will assign you a schedule based on your course schedule only.
      </p>

      {anyHighDemand && (
        <p
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#555",
            fontSize: 13,
            marginTop: 4,
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 3,
              height: 12,
              background: "#d33",
              flex: "none",
            }}
          />
          <span>
            This mark means a lot of students already picked that shift. Choosing less busy
            shifts can help you get the hours you want.
          </span>
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "flex-start" }}>
        <Grid
          sub={props.gridModel.weekday}
          selected={selected}
          covered={coveredKeys}
          autoAssigned={autoAssigned}
          onToggle={toggle}
          editable={editable}
        />

        {props.gridModel.weekend && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Grid
              sub={props.gridModel.weekend}
              selected={selected}
              covered={coveredKeys}
              autoAssigned={autoAssigned}
              onToggle={toggle}
              editable={editable}
            />
            <p
              style={{
                background: "#f5f5f5",
                padding: "0.6rem 0.8rem",
                borderRadius: 6,
                fontSize: 14,
                marginTop: 12,
              }}
            >
              You&apos;ll be placed on an <strong>A/B weekend rotation</strong> (a weekend shift
              every other weekend).
              <label style={{ display: "block", marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={optIn}
                  disabled={!editable}
                  onChange={(e) => setOptIn(e.target.checked)}
                />{" "}
                I&apos;d rather work <strong>every</strong> weekend (in exchange for fewer weekday
                shifts).
              </label>
            </p>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          margin: "1.2rem 0",
        }}
      >
        <label>
          Desired weekly hours <span style={{ color: "#b00" }}>(required)</span>:{" "}
          <input
            type="number"
            min={minHours}
            required
            value={desired}
            disabled={!editable}
            onChange={(e) => setDesired(e.target.value)}
            style={{ width: 70 }}
          />
        </label>
        {editable && (
          <>
            <button type="button" onClick={() => setDesired(String(minHours))}>
              Min ({minHours}h)
            </button>
            <button type="button" onClick={() => setDesired(String(maxHours))}>
              Max ({maxHours}h)
            </button>
          </>
        )}
      </div>
      <p style={{ color: "#555", fontSize: 14 }}>
        International students are limited to a maximum of 20 hours/week. Domestic students are limited to 30 hours/week.
      </p>

      <div style={{ margin: "1.2rem 0" }}>
        <label htmlFor="schedule-notes" style={{ display: "block", color: "#555", marginBottom: 6 }}>
          Anything we should know about your schedule?{" "}
          <span style={{ color: "#888" }}>(optional)</span>
        </label>
        <textarea
          id="schedule-notes"
          value={notes}
          readOnly={!editable}
          onChange={(e) => {
            setNotes(e.target.value);
            setMessage(null);
          }}
          rows={3}
          placeholder="e.g. I prefer mornings; I have a standing commitment Tue afternoons; happy to close on Fridays…"
          style={{ width: "100%", maxWidth: 640, boxSizing: "border-box", padding: 8 }}
        />
      </div>

      <ChecklistPanel
        summary={`${validation.capacity.weeklyAverageHours.toFixed(1)}h available · ${validation.daysCovered} day(s) selected`}
        items={requirements}
      />

      <div style={{ display: "flex", gap: 10, marginTop: "1rem", alignItems: "center" }}>
        {editable && !editMode && (
          <>
            <ActionButton
              variant="secondary"
              onClick={() => run("draft")}
              pending={pending}
              pendingLabel="Saving…"
            >
              Save draft
            </ActionButton>
            <ActionButton
              onClick={() => run("continue", "/travel")}
              pending={pending}
              pendingLabel="Saving…"
              disabled={!canSubmit}
            >
              Save and continue
            </ActionButton>
          </>
        )}
        {editable && editMode && (
          <ActionButton
            onClick={() => run("continue")}
            pending={pending}
            pendingLabel="Saving…"
            disabled={!canSubmit}
          >
            Save changes
          </ActionButton>
        )}
        {props.initialStatus === "submitted" && (
          <span style={{ color: "#196127" }}>✓ submitted</span>
        )}
        {!editable && (
          <span style={{ color: "#777" }}>
            Read-only. Your form window isn&apos;t open for edits right now.
          </span>
        )}
      </div>

      {message && (
        <p role="status" style={{ color: message.ok ? "#196127" : "#b00", marginTop: 10 }}>
          {message.text}
        </p>
      )}
    </div>
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
  return (
    <section>
      <h2 style={{ fontSize: 15, color: "#444" }}>{heading}</h2>
      <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th />
            {sub.days.map((d) => (
              <th key={d} style={{ padding: "2px 6px", fontWeight: 500 }}>
                {DAY_LABEL[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sub.rows.map((row) => (
            <tr key={row.block.id}>
              <th
                scope="row"
                style={{
                  textAlign: "right",
                  padding: "2px 8px",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                }}
              >
                {row.label}
                {row.isOpen && <span style={{ color: "#1a66cc" }}> · open</span>}
                {row.isClose && <span style={{ color: "#1a66cc" }}> · close</span>}
              </th>
              {sub.days.map((day, di) => {
                const key = selectionKey(row.block.id, day);
                const on = selected.has(key);
                const isAuto = !on && autoAssigned.has(key);
                const isCovered = !on && !isAuto && covered.has(key);
                const isHot = row.highDemandDays[di];
                return (
                  <td key={day} style={{ padding: 2 }}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${row.label} ${DAY_LABEL[day]}`}
                      title={
                        isAuto
                          ? "We auto-assigned this weekend shift because you didn't pick one. Click to choose your own."
                          : isCovered
                            ? "Already covered by a longer shift you selected"
                            : isHot
                              ? "A lot of students picked this shift"
                              : undefined
                      }
                      onClick={() => onToggle(row.block.id, day)}
                      style={{
                        position: "relative",
                        width: 30,
                        height: 26,
                        borderRadius: 4,
                        border: isAuto
                          ? "1px solid #9575cd"
                          : isCovered
                            ? "1px solid #d8c97a"
                            : "1px solid #ccc",
                        background: on
                          ? "#1a66cc"
                          : isAuto
                            ? "#ede7f6"
                            : isCovered
                              ? "#f0e6ad"
                              : "#fff",
                        color: on
                          ? "#fff"
                          : isAuto
                            ? "#5e35b1"
                            : isCovered
                              ? "#8a7400"
                              : "transparent",
                        cursor: editable ? "pointer" : "default",
                      }}
                    >
                      {isHot && (
                        <span
                          aria-hidden
                          style={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            width: 3,
                            height: 8,
                            background: "#d33",
                            borderRadius: 1,
                            pointerEvents: "none",
                          }}
                        />
                      )}
                      {on ? "✓" : isAuto ? "★" : isCovered ? "–" : "✓"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ChecklistPanel({ summary, items }: { summary: string; items: RequirementItem[] }) {
  return (
    <section
      style={{
        marginTop: "1.2rem",
        border: "1px solid #e2e2e2",
        borderRadius: 8,
        padding: "0.8rem 1rem",
      }}
    >
      <div style={{ fontSize: 14, color: "#555", marginBottom: 6 }}>Requirements ({summary})</div>
      <ul
        style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, display: "grid", gap: 4 }}
      >
        {items.map((c) => (
          <li
            key={c.key}
            style={{ color: c.passed ? "#196127" : c.severity === "hard" ? "#b00" : "#946c00" }}
          >
            {c.passed ? "✓" : c.severity === "hard" ? "✗" : "⚠"} {c.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
