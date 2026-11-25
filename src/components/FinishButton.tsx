"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { finalizeSubmission } from "@/lib/availability/actions";
import { ActionBar, Button, ButtonLink, StatusLine } from "@/components/student/ui";

/**
 * The exit-page submit (PLAN §13), in the page's action bar beside the Back
 * link. Calls finalizeSubmission, the single place a submission flips to
 * "submitted", and on success returns the student to /me (now the "done"
 * view). On a validation/missing-course-schedule error it shows the message
 * with a link to the step that needs fixing.
 */
export function FinishButton({ backHref }: { backHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ message: string; fixHref?: string } | null>(null);

  function submit() {
    setErr(null);
    start(async () => {
      const res = await finalizeSubmission();
      if (res.ok) {
        router.push("/me");
        router.refresh();
        return;
      }
      setErr({ message: res.error ?? "Something went wrong.", fixHref: res.fixHref });
    });
  }

  return (
    <ActionBar
      status={
        err && (
          <StatusLine ok={false} role="alert">
            {err.message} {err.fixHref && <Link href={err.fixHref}>Go fix it</Link>}
          </StatusLine>
        )
      }
    >
      <ButtonLink href={backHref} variant="secondary">
        Back
      </ButtonLink>
      <Button onClick={submit} pending={pending} pendingLabel="Submitting…">
        Submit my preferences
      </Button>
    </ActionBar>
  );
}
