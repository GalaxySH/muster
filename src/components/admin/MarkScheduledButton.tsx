"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setScheduled } from "@/lib/admin/actions";

/**
 * The "mark scheduled ✓" toggle (PLAN §10a): tracks W2W-entry progress across
 * the roster without leaving Muster. Optimistic UI is unnecessary at this scale;
 * we just refresh after the server confirms.
 */
export function MarkScheduledButton({
  studentEmail,
  scheduled,
}: {
  studentEmail: string;
  scheduled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await setScheduled(studentEmail, !scheduled);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={scheduled}
      style={{
        fontSize: 13,
        padding: "5px 12px",
        borderRadius: "var(--border-radius-md)",
        cursor: pending ? "default" : "pointer",
        border: scheduled ? "1px solid var(--color-text-success)" : "1px solid var(--color-border-secondary)",
        background: scheduled ? "#e6f4ea" : "var(--color-background-primary)",
        color: scheduled ? "var(--color-text-success)" : "var(--color-text-primary)",
      }}
    >
      {pending ? "saving…" : scheduled ? "✓ scheduled" : "mark scheduled"}
    </button>
  );
}
