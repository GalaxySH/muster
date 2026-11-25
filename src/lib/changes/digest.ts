/**
 * The daily schedule-change digest run (roadmap 3.1), triggered by the
 * in-app scheduler (scheduler.ts) and, as a manual fallback, by the
 * token-authenticated /api/cron/change-digest route.
 *
 * Recipients come ONLY from the admin-configured list on
 * /admin/email-settings (never ADMIN_EMAILS or admin_users). The run is
 * idempotent via `change_requests.digestSentAt`: only open, unstamped rows
 * are reported, and rows are stamped after a successful send. Every skip
 * leaves rows unstamped so no request is silently lost; a crash between send
 * and stamp re-sends rather than drops, under the same idempotency key, which
 * Resend treats as the same email for a day.
 */
import "server-only";
import { createHash } from "node:crypto";
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
  // The key names this batch and this recipient. A send that timed out after
  // Resend took it, then went out again with the same requests, is one email.
  const batch = createHash("sha256")
    .update(
      pending
        .map((p) => p.id)
        .sort()
        .join(","),
    )
    .digest("hex")
    .slice(0, 32);
  let delivered = 0;
  for (const to of recipients) {
    const recipient = createHash("sha256").update(to).digest("hex").slice(0, 16);
    try {
      const { outcome } = await sendEmail({
        to,
        ...email,
        idempotencyKey: `change-digest-${batch}-${recipient}`,
      });
      if (outcome === "sent") delivered += 1;
    } catch (e) {
      // One address failing must not undo the others: without this the rows
      // stayed unstamped and everyone already reached got the digest again.
      console.error("Change digest send failed for one recipient:", e);
    }
  }
  // A message only logged (no Resend key) or blocked by the dev test-recipient
  // guard reached nobody, so the rows stay unstamped for a later digest rather
  // than reading as reported.
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
