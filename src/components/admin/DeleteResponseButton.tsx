"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteResponse } from "@/lib/admin/actions";

/**
 * Admin-only "delete response" control (PLAN §10). Confirms, then permanently
 * removes the student's submission (availability, flags, and uploaded proofs).
 * Used both in the response list (compact "icon" variant, inside a clickable
 * row — so it stops propagation) and in the per-student header ("full" variant,
 * which redirects back to the list on success).
 */
export function DeleteResponseButton({
  studentEmail,
  displayName,
  redirectTo,
  variant = "full",
}: {
  studentEmail: string;
  displayName: string;
  redirectTo?: string;
  variant?: "full" | "icon";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick(e: React.MouseEvent) {
    // The list row is itself clickable; don't navigate into the student view.
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete ${displayName}'s response?\n\nThis permanently removes their availability, ` +
        `flags, and any uploaded proof files. It can't be undone. (Their roster record stays.)`,
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await deleteResponse(studentEmail);
      if (!res.ok) {
        alert(res.error ?? "Could not delete the response.");
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label={`Delete ${displayName}'s response`}
        title="Delete response"
        style={{
          fontSize: 13,
          padding: "3px 8px",
          borderRadius: "var(--border-radius-md)",
          cursor: pending ? "default" : "pointer",
          border: "0.5px solid var(--color-border-secondary)",
          background: "var(--color-background-primary)",
          color: "var(--color-text-danger)",
          opacity: pending ? 0.5 : 1,
        }}
      >
        {pending ? "…" : "Delete"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        fontSize: 13,
        padding: "5px 12px",
        borderRadius: "var(--border-radius-md)",
        cursor: pending ? "default" : "pointer",
        border: "1px solid var(--color-border-danger, #d93025)",
        background: "var(--color-background-primary)",
        color: "var(--color-text-danger)",
        opacity: pending ? 0.5 : 1,
      }}
    >
      {pending ? "Deleting…" : "Delete response"}
    </button>
  );
}
