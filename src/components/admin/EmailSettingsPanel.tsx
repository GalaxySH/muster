"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, InfoCard } from "@/components/ui";
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
    <div>
      <InfoCard
        tone={enabled ? "success" : "danger"}
        title={enabled ? "Email sending is on" : "Email sending is off"}
      >
        <p style={{ marginTop: 0 }}>
          {enabled
            ? "The app is sending emails normally."
            : "Sending emails is currently disabled."}
        </p>
        <ActionButton
          onClick={toggle}
          variant={enabled ? "secondary" : "primary"}
          pending={pending}
          pendingLabel="Saving…"
        >
          {enabled ? "Turn off email sending" : "Turn on email sending"}
        </ActionButton>
      </InfoCard>

      {!resendConfigured && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          No Resend API key is set on this server, so even with sending on, emails are only written
          to the server log (local testing).
        </p>
      )}
    </div>
  );
}
