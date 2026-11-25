"use client";

import { useState } from "react";
import { StepActions } from "@/components/student/ui";

/**
 * Travel-step gate (PLAN §4). Travel is optional, so we can't require an entry to
 * advance; instead the student must explicitly acknowledge they're done before
 * the "Continue" button enables. `nextHref` comes from the position-aware step
 * list (SLs continue to /closes, everyone else to /exit).
 */
export function TravelContinue({ nextHref }: { nextHref: string }) {
  const [ack, setAck] = useState(false);
  return (
    <>
      <label className="sf-check sf-ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I&apos;ve added all my travel, or I don&apos;t have any to add.</span>
      </label>
      <StepActions
        backHref="/availability"
        nextHref={nextHref}
        blockedReason={ack ? undefined : "Check the box above to continue."}
      />
    </>
  );
}
