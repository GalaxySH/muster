"use client";

/**
 * The show-resolved toggle on the change-request queue. Off by default; state
 * lives in the ?resolved=1 query param so the server page drives the query
 * and the view survives refresh.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function ShowResolvedToggle({ showResolved }: { showResolved: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(checked: boolean) {
    startTransition(() => {
      router.replace(checked ? "/admin/change-requests?resolved=1" : "/admin/change-requests");
    });
  }

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
      <input
        type="checkbox"
        checked={showResolved}
        disabled={pending}
        onChange={(e) => toggle(e.target.checked)}
      />
      Show resolved
    </label>
  );
}
