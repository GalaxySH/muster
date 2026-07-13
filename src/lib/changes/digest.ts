/**
 * The daily schedule-change digest run (roadmap 3.1), triggered by host cron
 * through the token-authenticated /api/cron/change-digest route (no
 * in-process scheduler, matching the ops posture).
 *
 * Recipients come ONLY from the admin-configured list on
 * /admin/email-settings (never ADMIN_EMAILS or admin_users). The run is
 * idempotent via `change_requests.digestSentAt`: only open, unstamped rows
 * are reported, and rows are stamped after a successful send. Every skip
 * leaves rows unstamped so no request is silently lost; a crash between send
 * and stamp re-sends rather than drops.
 */
import "server-only";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { changeRequests } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  getChangeDigestEnabled,
  getChangeDigestRecipients,
  getEmailSendingEnabled,
  markChangeDigestRun,
} from "@/lib/settings";
import { sendEmail } from "@/lib/email/resend";
import { loadPendingDigestRequests } from "./data";
import { buildChangeDigestEmail } from "./digest-email";

export interface ChangeDigestRunResult {
  sent: boolean;
  /** How many requests were in the pending batch. */
  requestCount: number;
  recipientCount: number;
  /** Why nothing was sent (absent on success). */
  reason?: "no-requests" | "digest-off" | "no-recipients" | "email-off";
}

export async function runChangeDigest(now: Date = new Date()): Promise<ChangeDigestRunResult> {
  // Stamped before any early return, so a run that sends nothing still proves
  // the cron fired. The admin hub reads this to tell a dead cron from a quiet
  // week; every `return` below is a run that happened.
  await markChangeDigestRun(now);

  const pending = await loadPendingDigestRequests();
  const base = { sent: false, requestCount: pending.length, recipientCount: 0 };
  if (pending.length === 0) return { ...base, reason: "no-requests" };
  if (!(await getChangeDigestEnabled())) return { ...base, reason: "digest-off" };

  const recipients = await getChangeDigestRecipients();
  if (recipients.length === 0) return { ...base, reason: "no-recipients" };
  // sendEmail would suppress silently under the master kill-switch; checking
  // here keeps the rows unstamped so they surface in a later digest instead.
  if (!(await getEmailSendingEnabled())) return { ...base, reason: "email-off" };

  const email = buildChangeDigestEmail(pending, env.NEXTAUTH_URL);
  for (const to of recipients) {
    await sendEmail({ to, ...email });
  }

  await getDb()
    .update(changeRequests)
    .set({ digestSentAt: now })
    .where(
      inArray(
        changeRequests.id,
        pending.map((p) => p.id),
      ),
    );

  return { sent: true, requestCount: pending.length, recipientCount: recipients.length };
}
