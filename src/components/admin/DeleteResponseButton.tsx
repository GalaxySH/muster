"use client";

import { useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashCan } from "@awesome.me/kit-925f6dce39/icons/classic/regular";
import { deleteResponse } from "@/lib/admin/actions";
import { Button } from "./ui";

/**
 * Admin-only "delete response" control (PLAN §10). Confirms, then permanently
 * removes the student's submission (availability, flags, and uploaded proofs).
 * Used both in the response list (compact "icon" variant, inside a clickable
 * row, so it stops propagation) and in the per-student header ("full" variant,
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
  const termId = useRenderedTermId();
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
      const res = await deleteResponse(studentEmail, termId);
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
      <Button
        variant="quiet-danger"
        className="ad-btn--icon"
        onClick={onClick}
        disabled={pending}
        aria-label={`Delete ${displayName}'s response`}
        title="Delete response"
      >
        <FontAwesomeIcon icon={faTrashCan} aria-hidden />
      </Button>
    );
  }

  return (
    <Button variant="danger" onClick={onClick} pending={pending} pendingLabel="Deleting…">
      Delete response
    </Button>
  );
}
