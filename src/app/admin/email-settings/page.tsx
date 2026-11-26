import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
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
import { AdminPage } from "@/components/admin/AdminPage";
import { workingTerm } from "@/lib/terms/working";

export const metadata: Metadata = { title: "Email settings" };

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

  const [term, enabled, digestEnabled, digestRecipients, digestLastRun, scheduleEmail] =
    await Promise.all([
      workingTerm(),
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
    <AdminPage
      title="Email settings"
      width="form"
      description="The app sends email through Resend. Use the switch below to turn all outbound email on or off."
    >
      <div className="ad-stack">
        <EmailSettingsPanel enabled={enabled} resendConfigured={Boolean(env.RESEND_API_KEY)} />
        <DigestSettingsPanel
          enabled={digestEnabled}
          recipients={digestRecipients}
          health={health}
          lastRunAt={digestLastRun?.toISOString() ?? null}
        />
        <ScheduleEmailSettingsPanel
          config={scheduleEmail}
          termName={term.name}
          domain={fromDomain(env.EMAIL_FROM)}
          adminEmail={session.email}
        />
      </div>
    </AdminPage>
  );
}
