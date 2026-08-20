"use client";

import { useState, useTransition } from "react";
import {
  DAY_CAP_HOURS_MAX,
  DAY_CAP_HOURS_MIN,
  MAX_CONSECUTIVE_DAYS_MAX,
  MAX_CONSECUTIVE_DAYS_MIN,
  MAX_DAYS_PER_WEEK_MAX,
  MAX_DAYS_PER_WEEK_MIN,
  MIN_REST_HOURS_MAX,
  MIN_REST_HOURS_MIN,
  PREFERRED_DAYS_PER_WEEK_MIN,
  PREFERRED_REST_HOURS_MAX,
  REPEAT_START_PENALTY_MAX,
  REPEAT_START_PENALTY_MIN,
  type SchedulingParams,
} from "@/lib/domain/scheduling/params";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { saveScheduleParams } from "@/lib/schedule/actions";

/**
 * The engine's tunable knobs on /admin/schedule. Saved values apply from the
 * next Update schedule on; the server action revalidates and re-validates.
 */
export function ScheduleParamsForm({
  initial,
  positions,
}: {
  initial: SchedulingParams;
  positions: { id: string; name: string }[];
}) {
  const [dayCap, setDayCap] = useState(String(initial.dayCapHours));
  const [night, setNight] = useState(String(initial.nightPriority));
  const [evening, setEvening] = useState(String(initial.eveningPriority));
  const [repeatPenalty, setRepeatPenalty] = useState(String(initial.repeatStartPenalty));
  const [minRest, setMinRest] = useState(String(initial.minRestHours));
  const [preferredRest, setPreferredRest] = useState(String(initial.preferredRestHours));
  const [maxRun, setMaxRun] = useState(String(initial.maxConsecutiveDays));
  const [maxDays, setMaxDays] = useState(String(initial.maxDaysPerWeek));
  const [preferredDays, setPreferredDays] = useState(String(initial.preferredDaysPerWeek));
  const [pool, setPool] = useState<string[]>(initial.coveragePoolPositionIds);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const togglePool = (id: string, on: boolean) =>
    setPool((ids) => (on ? [...ids, id] : ids.filter((p) => p !== id)));

  const submit = () => {
    startTransition(async () => {
      const res = await saveScheduleParams({
        dayCapHours: Number(dayCap),
        nightPriority: Number(night),
        eveningPriority: Number(evening),
        repeatStartPenalty: Number(repeatPenalty),
        minRestHours: Number(minRest),
        preferredRestHours: Number(preferredRest),
        maxConsecutiveDays: Number(maxRun),
        maxDaysPerWeek: Number(maxDays),
        preferredDaysPerWeek: Number(preferredDays),
        // Ordered by the position list, so the saved value does not depend on
        // the order the admin clicked the boxes. Saved ids the list does not
        // offer are carried through rather than dropped: deactivating a
        // position does not retire its blocks, so it keeps producing seats and
        // keeps being pooled, and an unrelated save must not be what quietly
        // ends that. Shift Lead is the one id we do drop, because the
        // statistics discard it from the pool and measure leads on their own.
        coveragePoolPositionIds: [
          ...positions.map((p) => p.id).filter((id) => pool.includes(id)),
          ...initial.coveragePoolPositionIds.filter(
            (id) => id !== SHIFT_LEAD_POSITION_ID && !positions.some((p) => p.id === id),
          ),
        ],
      });
      setMsg(
        res.ok ? "Saved. Applies the next time the schedule is updated." : (res.error ?? "Failed."),
      );
    });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <Field
          label="Max hours per day"
          help="The most hours one student works in a single day."
          value={dayCap}
          onChange={setDayCap}
          min={DAY_CAP_HOURS_MIN}
          max={DAY_CAP_HOURS_MAX}
        />
        <Field
          label="Night priority"
          help="0 fills all shifts evenly. 100 fills night shifts to target first."
          value={night}
          onChange={setNight}
          min={0}
          max={100}
        />
        <Field
          label="Evening priority"
          help="Same scale for shifts ending 5pm to 8pm."
          value={evening}
          onChange={setEvening}
          min={0}
          max={100}
        />
        <Field
          label="Repeat start penalty"
          help="0 ignores repeats. 100 pushes hardest against giving one student the same start time again."
          value={repeatPenalty}
          onChange={setRepeatPenalty}
          min={REPEAT_START_PENALTY_MIN}
          max={REPEAT_START_PENALTY_MAX}
        />
        <Field
          label="Minimum rest hours"
          help="The least rest between one day's last shift and the next day's first."
          value={minRest}
          onChange={setMinRest}
          min={MIN_REST_HOURS_MIN}
          max={MIN_REST_HOURS_MAX}
        />
        <Field
          label="Preferred rest hours"
          help="The rest the engine aims for between days. At least the minimum."
          value={preferredRest}
          onChange={setPreferredRest}
          min={MIN_REST_HOURS_MIN}
          max={PREFERRED_REST_HOURS_MAX}
        />
        <Field
          label="Max consecutive days"
          help="The most days in a row one student works."
          value={maxRun}
          onChange={setMaxRun}
          min={MAX_CONSECUTIVE_DAYS_MIN}
          max={MAX_CONSECUTIVE_DAYS_MAX}
        />
        <Field
          label="Max days per week"
          help="The most working days in one week."
          value={maxDays}
          onChange={setMaxDays}
          min={MAX_DAYS_PER_WEEK_MIN}
          max={MAX_DAYS_PER_WEEK_MAX}
        />
        <Field
          label="Preferred days per week"
          help="The days per week the engine aims for. At most the max."
          value={preferredDays}
          onChange={setPreferredDays}
          min={PREFERRED_DAYS_PER_WEEK_MIN}
          max={MAX_DAYS_PER_WEEK_MAX}
        />
        <fieldset style={fieldsetStyle}>
          <legend style={{ fontWeight: 600, fontSize: 13, padding: 0 }}>
            Cross-coverage positions
          </legend>
          <span style={{ color: "var(--color-text-secondary)", fontSize: 13, flexGrow: 1 }}>
            Positions that cover for each other. Schedule health counts them as one. Does not change
            generation.
          </span>
          {positions.map((p) => (
            <label key={p.id} style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={pool.includes(p.id)}
                onChange={(e) => togglePool(p.id, e.target.checked)}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="button" onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
      {msg && (
        <p
          role="status"
          style={{ margin: "8px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}
        >
          {msg}
        </p>
      )}
    </div>
  );
}

const fieldsetStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  flex: "1 1 200px",
  minWidth: 180,
  border: 0,
  margin: 0,
  padding: 0,
};

const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

function Field({
  label,
  help,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 13,
        flex: "1 1 160px",
        minWidth: 150,
      }}
    >
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ color: "var(--color-text-secondary)", flexGrow: 1 }}>{help}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 90,
          padding: "6px 8px",
          borderRadius: "var(--border-radius-md)",
          border: "0.5px solid var(--color-border-secondary)",
          background: "var(--color-background-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
        }}
      />
    </label>
  );
}
