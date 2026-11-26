"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setChangeRequestsEnabled } from "@/lib/admin/actions";
import { Button, Pill, SettingRow } from "./ui";

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
    <SettingRow
      name="Change request form"
      help={
        enabled
          ? "Students see a change-request card on their profile page and are pointed to the form from the intro step."
          : "Students are told to email us instead. This queue and the form itself stay reachable by direct link."
      }
    >
      <Pill tone={enabled ? "success" : undefined}>{enabled ? "On" : "Off"}</Pill>
      <Button
        onClick={toggle}
        variant={enabled ? "secondary" : "primary"}
        pending={pending}
        pendingLabel="Saving…"
      >
        {enabled ? "Turn off the form" : "Turn on the form"}
      </Button>
    </SettingRow>
  );
}
