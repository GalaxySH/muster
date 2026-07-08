import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { getEmailSendingEnabled } from "@/lib/settings";
import { env } from "@/lib/env";
import { EmailSettingsPanel } from "@/components/admin/EmailSettingsPanel";
import { Page } from "@/components/ui";

/**
 * Email settings: a master switch to enable or disable all outbound email (sent
 * through Resend). Turning it off is a global kill-switch honored by `sendEmail`.
 */
export default async function EmailSettingsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/email-settings");
  if (!session.isAdmin) redirect("/me");

  const enabled = await getEmailSendingEnabled();

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Email settings</h1>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        The app sends email through Resend. Use the switch below to turn all outbound email on
        or off.
      </p>
      <EmailSettingsPanel enabled={enabled} resendConfigured={Boolean(env.RESEND_API_KEY)} />
    </Page>
  );
}
