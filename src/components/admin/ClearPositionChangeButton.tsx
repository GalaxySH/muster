"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearPositionChangeFlag } from "@/lib/admin/actions";

/**
 * Dismisses a position_change flag from the per-student flags pane (roadmap
 * 3.3). Only this flag type gets a manual dismiss; revalidation_failed clears
 * itself when a validation run passes.
 */
export function ClearPositionChangeButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function clear() {
    startTransition(async () => {
      const res = await clearPositionChangeFlag(submissionId);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not clear the flag.");
    });
  }

  return (
    <button
      type="button"
      onClick={clear}
      disabled={pending}
      style={{
        fontSize: 12,
        padding: "2px 10px",
        borderRadius: "var(--border-radius-md)",
        cursor: pending ? "default" : "pointer",
        border: "1px solid var(--color-border-secondary)",
        background: "var(--color-background-primary)",
        color: "var(--color-text-primary)",
        whiteSpace: "nowrap",
      }}
    >
      {pending ? "clearing…" : "Clear"}
    </button>
  );
}
