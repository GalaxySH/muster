"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel, Pill, SettingRow } from "@/components/admin/ui";
import { setEmailSendingEnabled } from "@/lib/admin/actions";

/**
 * The master email switch (dashboard settings). When off, the app sends no
 * outbound email at all: sign-in links and the change digest both stop until
 * it is turned back on. The switch lives in `app_settings` and is enforced
 * in `sendEmail`.
 */
export function EmailSettingsPanel({
  enabled,
  resendConfigured,
}: {
  enabled: boolean;
  resendConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (
      enabled &&
      !confirm(
        "Turn off all outbound email? Sign-in links and notifications will stop until you turn it back on.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await setEmailSendingEnabled(!enabled);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  return (
    <Panel
      title="Sending"
      aside={<Pill tone={enabled ? "success" : "danger"}>{enabled ? "On" : "Off"}</Pill>}
    >
      <SettingRow
        name="Email sending"
        help={
          enabled ? "The app is sending emails normally." : "Sending emails is currently disabled."
        }
      >
        <Button
          onClick={toggle}
          variant={enabled ? "secondary" : "primary"}
          pending={pending}
          pendingLabel="Saving…"
        >
          {enabled ? "Turn off email sending" : "Turn on email sending"}
        </Button>
      </SettingRow>

      {!resendConfigured && (
        <p className="ad-help">
          No Resend API key is set on this server, so even with sending on, emails are only written
          to the server log (local testing).
        </p>
      )}
    </Panel>
  );
}
