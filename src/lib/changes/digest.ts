/**
 * The daily schedule-change digest run (roadmap 3.1), triggered by the
 * in-app scheduler (scheduler.ts) and, as a manual fallback, by the
 * token-authenticated /api/cron/change-digest route.
 *
 * Recipients come ONLY from the admin-configured list on
 * /admin/email-settings (never ADMIN_EMAILS or admin_users). The run is
 * idempotent via `change_requests.digestSentAt`: only open, unstamped rows
 * are reported, and rows are stamped once the digest went out to at least one
 * recipient, even if another recipient's send failed. That recipient misses
 * this digest; the requests still show in the admin queue. A run that reached
 * nobody (skipped, only logged, blocked or suppressed, or every send failed)
 * leaves rows unstamped, so the next run sends the batch again. A send that
 * timed out may have gone out anyway; if the retry is within about a day,
 * `sendEmail` drops the identical message as a repeat.
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
  /**
   * Why the requests were not marked reported (absent on success).
   * `not-delivered` means no recipient got it: every message was only logged,
   * blocked or suppressed, or every send failed.
   */
  reason?: "no-requests" | "digest-off" | "no-recipients" | "email-off" | "not-delivered";
}

export async function runChangeDigest(now: Date = new Date()): Promise<ChangeDigestRunResult> {
  // Stamped before any early return, so a run that sends nothing still proves
  // the scheduler fired. The admin surfaces read this to tell a dead scheduler
  // from a quiet week; every `return` below is a run that happened.
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
  let delivered = 0;
  for (const to of recipients) {
    try {
      const { outcome } = await sendEmail({ to, ...email });
      if (outcome === "sent") delivered += 1;
    } catch (e) {
      // Keep going so one bad address does not stop the rest. If anyone else
      // gets the digest, the rows are stamped and this recipient misses it.
      console.error(
        "Change digest send failed for one recipient; not retried if anyone else got it:",
        e,
      );
    }
  }
  // A message only logged (no Resend key) or blocked by the dev test-recipient
  // guard reached nobody, so it does not count as delivered. With nobody
  // reached the rows stay unstamped for a later digest.
  if (delivered === 0) {
    return { ...base, recipientCount: recipients.length, reason: "not-delivered" };
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
