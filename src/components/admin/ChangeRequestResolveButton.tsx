"use client";

/**
 * Admin control on one schedule change request (roadmap 3.1): mark it
 * resolved after updating W2W, or reopen it. Withdrawn requests belong to the
 * student and show no control.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setChangeRequestResolved } from "@/lib/changes/admin-actions";
import type { ChangeRequestStatus } from "@/lib/changes/data";

export function ChangeRequestResolveButton({
  id,
  status,
}: {
  id: string;
  status: ChangeRequestStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (status === "withdrawn") return null;

  function toggle() {
    startTransition(async () => {
      const res = await setChangeRequestResolved(id, status === "open");
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  return (
    <button type="button" onClick={toggle} disabled={pending} style={btn}>
      {pending ? "Saving…" : status === "open" ? "Mark resolved" : "Reopen"}
    </button>
  );
}

const btn: React.CSSProperties = {
  fontSize: 12,
  padding: "3px 10px",
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  cursor: "pointer",
};
