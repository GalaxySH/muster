"use client";

/**
 * Admin "resolved" checkbox on one schedule change request (roadmap 3.1),
 * rendered wherever a request appears (the queue, the per-student page).
 * Checked = resolved; unchecking reopens. Withdrawn requests belong to the
 * student and show no control.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setChangeRequestResolved } from "@/lib/changes/admin-actions";
import type { ChangeRequestStatus } from "@/lib/changes/data";

export function ChangeRequestResolvedCheckbox({
  id,
  status,
}: {
  id: string;
  status: ChangeRequestStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (status === "withdrawn") return null;

  function toggle(checked: boolean) {
    startTransition(async () => {
      const res = await setChangeRequestResolved(id, checked);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, whiteSpace: "nowrap", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={status === "resolved"}
        disabled={pending}
        onChange={(e) => toggle(e.target.checked)}
      />
      resolved
    </label>
  );
}
