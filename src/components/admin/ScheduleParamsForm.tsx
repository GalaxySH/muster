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
import { saveScheduleParams } from "@/lib/schedule/actions";

/**
 * The engine's tunable knobs on /admin/schedule. Saved values apply from the
 * next Update schedule on; the server action revalidates and re-validates.
 */
export function ScheduleParamsForm({ initial }: { initial: SchedulingParams }) {
  const [dayCap, setDayCap] = useState(String(initial.dayCapHours));
  const [night, setNight] = useState(String(initial.nightPriority));
  const [evening, setEvening] = useState(String(initial.eveningPriority));
  const [repeatPenalty, setRepeatPenalty] = useState(String(initial.repeatStartPenalty));
  const [minRest, setMinRest] = useState(String(initial.minRestHours));
  const [preferredRest, setPreferredRest] = useState(String(initial.preferredRestHours));
  const [maxRun, setMaxRun] = useState(String(initial.maxConsecutiveDays));
  const [maxDays, setMaxDays] = useState(String(initial.maxDaysPerWeek));
  const [preferredDays, setPreferredDays] = useState(String(initial.preferredDaysPerWeek));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
