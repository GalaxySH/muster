"use client";

/**
 * Admin "resolved" checkbox on one travel entry (PLAN.md §10a), rendered on the
 * upcoming-travel list and the per-student page. Checked = the scheduler has
 * accounted for the trip; unchecking reopens it. Separate from the cutoff-derived
 * "excused" flag.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTravelResolved } from "@/lib/admin/actions";

export function TravelResolvedCheckbox({ id, resolved }: { id: string; resolved: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(checked: boolean) {
    startTransition(async () => {
      const res = await setTravelResolved(id, checked);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={resolved}
        disabled={pending}
        onChange={(e) => toggle(e.target.checked)}
      />
      resolved
    </label>
  );
}
