"use client";

/**
 * Change one student's position from their own page.
 *
 * Confirms first, and the confirm spells out what goes: a position change
 * removes the student's shifts outright (they were seats on the old position's
 * blocks and mean nothing on the new one) and clears the scheduled marker.
 * Picks are the exception and the copy says so, because "your picks are kept"
 * is the part an admin would otherwise have to discover.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeStudentPosition } from "@/lib/positions/actions";

export interface StudentPositionChangerProps {
  studentEmail: string;
  currentPositionId: string | null;
  options: { id: string; name: string }[];
}

export function StudentPositionChanger({
  studentEmail,
  currentPositionId,
  options,
}: StudentPositionChangerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const choices = options.filter((o) => o.id !== currentPositionId);
  const chosen = choices.find((o) => o.id === target);

  function submit() {
    if (!chosen) return;
    const ok = window.confirm(
      `Move ${studentEmail} to ${chosen.name}?\n\n` +
        "Their scheduled shifts will be removed and they will be marked not scheduled. " +
        "Shift picks that match a shift at the same time are moved across; the rest stay " +
        "on their grid marked as old picks for you to review.",
    );
    if (!ok) return;

    startTransition(async () => {
      const res = await changeStudentPosition(studentEmail, chosen.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "That did not work." });
        return;
      }
      const parts = [`Moved to ${chosen.name}.`, `${res.carriedOver} picks moved across.`];
      if (res.preserved > 0) parts.push(`${res.preserved} left to review.`);
      if (res.removedShifts > 0) {
        parts.push(
          `${res.removedShifts} scheduled shift${res.removedShifts === 1 ? "" : "s"} removed.`,
        );
      }
      setMsg({ ok: true, text: parts.join(" ") });
      setTarget("");
      router.refresh();
    });
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Change position</div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={pending}
          aria-label="New position"
          style={select}
        >
          <option value="">Pick a position</option>
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={submit} disabled={pending || !chosen} style={button}>
          {pending ? "Moving..." : "Move"}
        </button>
      </div>
      {msg && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

const select: React.CSSProperties = {
  flex: "1 1 10rem",
  minWidth: 0,
  fontSize: 13,
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
};

const button: React.CSSProperties = {
  fontSize: 13,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-secondary)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};
