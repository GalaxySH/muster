import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import {
  getEmailSendingEnabled,
  getChangeDigestEnabled,
  getChangeDigestRecipients,
  getChangeDigestLastRun,
  getScheduleEmailConfig,
} from "@/lib/settings";
import { fromDomain } from "@/lib/email/schedule-email";
import { digestRunHealth } from "@/lib/changes/digest-health";
import { digestSchedulerEnabled, env } from "@/lib/env";
import { EmailSettingsPanel } from "@/components/admin/EmailSettingsPanel";
import { DigestSettingsPanel } from "@/components/admin/DigestSettingsPanel";
import { ScheduleEmailSettingsPanel } from "@/components/admin/ScheduleEmailSettingsPanel";
import { Page } from "@/components/ui";

/**
 * Email settings: the master switch for all outbound email (honored by
 * `sendEmail`), the schedule-change digest settings (roadmap 3.1): its
 * own toggle and the admin-set recipient list that replaces the ADMIN_EMAILS
 * env allowlist for digest delivery, and the "schedule is posted" email's
 * template, cc and sender (docs/scheduler-automation.md).
 */
export default async function EmailSettingsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/email-settings");
  if (!session.isAdmin) redirect("/me");

  const [enabled, digestEnabled, digestRecipients, digestLastRun, scheduleEmail] =
    await Promise.all([
      getEmailSendingEnabled(),
      getChangeDigestEnabled(),
      getChangeDigestRecipients(),
      getChangeDigestLastRun(),
      getScheduleEmailConfig(),
    ]);
  const health = digestRunHealth({
    schedulerEnabled: digestSchedulerEnabled,
    lastRunAt: digestLastRun,
    uptimeMs: process.uptime() * 1000,
    now: new Date(),
  });

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Email settings</h1>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        The app sends email through Resend. Use the switch below to turn all outbound email on or
        off.
      </p>
      <EmailSettingsPanel enabled={enabled} resendConfigured={Boolean(env.RESEND_API_KEY)} />

      <h2 style={{ fontSize: 17, margin: "24px 0 6px" }}>Schedule-change digest</h2>
      <DigestSettingsPanel
        enabled={digestEnabled}
        recipients={digestRecipients}
        health={health}
        lastRunAt={digestLastRun?.toISOString() ?? null}
      />

      <h2 style={{ fontSize: 17, margin: "24px 0 6px" }}>Schedule email</h2>
      <ScheduleEmailSettingsPanel
        config={scheduleEmail}
        domain={fromDomain(env.EMAIL_FROM)}
        adminEmail={session.email}
      />
    </Page>
  );
}
