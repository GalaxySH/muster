"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissFlag, type DismissableFlag } from "@/lib/admin/actions";

/**
 * Dismisses one dismissable flag type from the per-student flags pane:
 * position_change after the admin reviews the change (roadmap 3.3), or
 * student_changed_after_internal_edit when the admin keeps the internal copy
 * as it is. revalidation_failed has no manual dismiss, it clears itself when
 * a validation run passes.
 */
export function DismissFlagButton({
  submissionId,
  type,
  label,
  title,
}: {
  submissionId: string;
  type: DismissableFlag;
  label: string;
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function clear() {
    startTransition(async () => {
      const res = await dismissFlag(submissionId, type);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not clear the flag.");
    });
  }

  return (
    <button
      type="button"
      onClick={clear}
      disabled={pending}
      title={title}
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
      {pending ? "clearing…" : label}
    </button>
  );
}
