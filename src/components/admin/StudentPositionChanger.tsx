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
import { useId, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { changeStudentPosition } from "@/lib/positions/actions";
import { ActionMessage, Button, Field } from "@/components/admin/ui";

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
  const termId = useRenderedTermId();
  const router = useRouter();
  const selectId = useId();
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
      const res = await changeStudentPosition(studentEmail, chosen.id, termId);
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
      if (res.releasedCloses > 0) {
        parts.push(
          `${res.releasedCloses} weekend close${res.releasedCloses === 1 ? "" : "s"} opened up.`,
        );
      }
      setMsg({ ok: true, text: parts.join(" ") });
      setTarget("");
      router.refresh();
    });
  }

  return (
    <Field label="Change position" htmlFor={selectId}>
      <div className="ad-row">
        <select
          id={selectId}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={pending}
          aria-label="New position"
          className="ad-st-grow"
        >
          <option value="">Pick a position</option>
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Button onClick={submit} pending={pending} pendingLabel="Moving..." disabled={!chosen}>
          Move
        </Button>
      </div>
      {msg &&
        (msg.ok ? (
          <p role="status" className="ad-help ad-success-text">
            {msg.text}
          </p>
        ) : (
          <ActionMessage ok={false} as="p">
            {msg.text}
          </ActionMessage>
        ))}
    </Field>
  );
}
