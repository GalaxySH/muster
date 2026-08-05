"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, InfoCard } from "@/components/ui";
import { setChangeRequestsEnabled } from "@/lib/admin/actions";

/**
 * Whether the student-facing change-request form is offered (roadmap 3.1).
 * Off hides the card on /me and swaps the /intro copy to point at email
 * instead; the /change-requests route and this admin queue stay reachable
 * either way, so nothing already submitted is affected.
 */
export function ChangeRequestsEnabledToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await setChangeRequestsEnabled(!enabled);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  return (
    <InfoCard
      tone={enabled ? "success" : "info"}
      title={enabled ? "Change request form is on" : "Change request form is off"}
    >
      <p style={{ marginTop: 0 }}>
        {enabled
          ? "Students see a change-request card on their profile page and are pointed to the form from the intro step."
          : "Students are told to email us instead. This queue and the form itself stay reachable by direct link."}
      </p>
      <ActionButton
        onClick={toggle}
        variant={enabled ? "secondary" : "primary"}
        pending={pending}
        pendingLabel="Saving…"
      >
        {enabled ? "Turn off the form" : "Turn on the form"}
      </ActionButton>
    </InfoCard>
  );
}
