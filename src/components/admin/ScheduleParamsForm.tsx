"use client";

import { useState, useTransition } from "react";
import {
  DAY_CAP_HOURS_MAX,
  DAY_CAP_HOURS_MIN,
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
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await saveScheduleParams({
        dayCapHours: Number(dayCap),
        nightPriority: Number(night),
        eveningPriority: Number(evening),
      });
      setMsg(
        res.ok ? "Saved. Applies the next time the schedule is updated." : (res.error ?? "Failed."),
      );
    });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
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
        <button type="button" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
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
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ color: "var(--color-text-secondary)", maxWidth: 220 }}>{help}</span>
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
