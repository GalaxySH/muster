"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissFlag, type DismissableFlag } from "@/lib/admin/actions";
import { Button } from "@/components/admin/ui";

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
    <Button
      onClick={clear}
      pending={pending}
      pendingLabel="clearing…"
      title={title}
      className="ad-nowrap"
    >
      {label}
    </Button>
  );
}
