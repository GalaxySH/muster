"use client";

import { useMemo, useState, useTransition } from "react";
import type { GridModel, SubGrid } from "@/lib/availability/grid";
import { selectionKey, keysToSelection, selectionToKeys } from "@/lib/availability/selection";
import { validateAvailability } from "@/lib/domain/validation";
import type { Day, Position, ShiftBlock } from "@/lib/domain/types";
import { saveAvailability } from "@/lib/availability/actions";

const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export interface AvailabilityFormProps {
  position: Position;
  blocks: ShiftBlock[];
  gridModel: GridModel;
  initialSelection: { blockId: string; day: Day }[];
  initialEveryWeekendOptIn: boolean;
  initialDesiredHours: number | null;
  initialStatus: "draft" | "submitted" | null;
  /** Admin inspection mode: live validation works, but nothing is persisted. */
  preview?: boolean;
}

export function AvailabilityForm(props: AvailabilityFormProps) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    selectionToKeys(props.initialSelection),
  );
  const [optIn, setOptIn] = useState(props.initialEveryWeekendOptIn);
  const [desired, setDesired] = useState(props.initialDesiredHours?.toString() ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selection = useMemo(() => keysToSelection(selected), [selected]);
  const validation = useMemo(
    () =>
      validateAvailability(selection, props.position, props.blocks, { everyWeekendOptIn: optIn }),
    [selection, optIn, props.position, props.blocks],
  );

  function toggle(blockId: string, day: Day) {
    setMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      const key = selectionKey(blockId, day);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save(submit: boolean) {
    if (props.preview) {
      setMessage({
        ok: true,
        text: `Preview mode — nothing saved. (Would ${submit ? "submit" : "save a draft"}.)`,
      });
      return;
    }
    startTransition(async () => {
      const res = await saveAvailability({
        selection,
        everyWeekendOptIn: optIn,
        desiredHours: desired ? Number(desired) : null,
        submit,
      });
      setMessage({
        ok: res.ok,
        text: res.ok
          ? submit
            ? "Submitted — you can keep editing until your window closes."
            : "Draft saved."
          : res.errors.join(" · "),
      });
    });
  }

  return (
    <div style={{ maxWidth: 760 }}>
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
          <strong>Admin preview</strong> — this is the student view of the {props.position.name}{" "}
          form. Toggling cells exercises live validation, but nothing is saved.
        </p>
      )}
      <h1>Your availability — {props.position.name}</h1>
      <p style={{ color: "#555" }}>
        Check every shift you&apos;d be willing to work. Selecting more than your hours is fine —
        these are preferences, not your final schedule.
      </p>

      <Grid sub={props.gridModel.weekday} selected={selected} onToggle={toggle} />

      {props.gridModel.weekend && (
        <>
          <Grid sub={props.gridModel.weekend} selected={selected} onToggle={toggle} />
          <p
            style={{
              background: "#f5f5f5",
              padding: "0.6rem 0.8rem",
              borderRadius: 6,
              fontSize: 14,
            }}
          >
            You&apos;ll be placed on an <strong>A/B weekend rotation</strong> (a weekend shift every
            other weekend).
            <label style={{ display: "block", marginTop: 6 }}>
              <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />{" "}
              I&apos;d rather work <strong>every</strong> weekend (in exchange for fewer weekday
              shifts).
            </label>
          </p>
        </>
      )}

      <label style={{ display: "block", margin: "1rem 0" }}>
        Desired weekly hours (optional):{" "}
        <input
          type="number"
          min={0}
          value={desired}
          onChange={(e) => setDesired(e.target.value)}
          style={{ width: 70 }}
        />
      </label>

      <ChecklistPanel validation={validation} />

      <div style={{ display: "flex", gap: 10, marginTop: "1rem", alignItems: "center" }}>
        <button type="button" onClick={() => save(false)} disabled={pending}>
          Save draft
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={pending || !validation.canSubmit}
        >
          Submit
        </button>
        {props.initialStatus === "submitted" && (
          <span style={{ color: "#196127" }}>✓ submitted</span>
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
  onToggle,
}: {
  sub: SubGrid;
  selected: Set<string>;
  onToggle: (blockId: string, day: Day) => void;
}) {
  const heading = sub.dayType === "weekday" ? "Weekdays" : "Weekend";
  return (
    <section style={{ marginTop: "1.2rem" }}>
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
                {row.block.highDemand && (
                  <span
                    aria-hidden
                    title="high demand"
                    style={{
                      display: "inline-block",
                      width: 3,
                      height: 11,
                      background: "#d33",
                      marginRight: 5,
                      verticalAlign: "-1px",
                    }}
                  />
                )}
                {row.label}
                {row.isOpen && <span style={{ color: "#1a66cc" }}> · open</span>}
                {row.isClose && <span style={{ color: "#1a66cc" }}> · close</span>}
              </th>
              {sub.days.map((day) => {
                const on = selected.has(selectionKey(row.block.id, day));
                return (
                  <td key={day} style={{ padding: 2 }}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${row.label} ${DAY_LABEL[day]}`}
                      onClick={() => onToggle(row.block.id, day)}
                      style={{
                        width: 30,
                        height: 26,
                        borderRadius: 4,
                        border: "1px solid #ccc",
                        background: on ? "#1a66cc" : "#fff",
                        color: on ? "#fff" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      ✓
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

function ChecklistPanel({ validation }: { validation: ReturnType<typeof validateAvailability> }) {
  return (
    <section
      style={{
        marginTop: "1.2rem",
        border: "1px solid #e2e2e2",
        borderRadius: 8,
        padding: "0.8rem 1rem",
      }}
    >
      <div style={{ fontSize: 14, color: "#555", marginBottom: 6 }}>
        Requirements — {validation.capacity.weeklyAverageHours.toFixed(1)}h reachable ·{" "}
        {validation.daysCovered} day(s)
      </div>
      <ul
        style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, display: "grid", gap: 4 }}
      >
        {validation.checks.map((c) => (
          <li
            key={c.id}
            style={{ color: c.passed ? "#196127" : c.severity === "hard" ? "#b00" : "#946c00" }}
          >
            {c.passed ? "✓" : c.severity === "hard" ? "✗" : "⚠"} {c.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}
