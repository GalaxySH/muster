"use server";

/**
 * Batch "your schedule is ready" email (roadmap 2.4). Admin picks a group; every
 * on-roster member whose submission is submitted AND scheduled and who hasn't been
 * emailed yet is notified once. Each success stamps `scheduleEmailSentAt`, so a
 * re-run (or a run that failed partway) only mails the remaining recipients.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getEmailSendingEnabled } from "@/lib/settings";
import { sendScheduleCreatedEmail } from "@/lib/email/resend";
import { loadScheduleEmailPreview } from "./data";

export interface ScheduleEmailSendResult {
  ok: boolean;
  error?: string;
  sent: number;
  failed: { email: string; error: string }[];
}

// Modest throttle between sends to stay under Resend's rate limit.
const THROTTLE_MS = 120;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const firstName = (name: string) => name.trim().split(/\s+/)[0] || undefined;

export async function sendScheduleCreatedEmails(
  groupId: string,
): Promise<ScheduleEmailSendResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error, sent: 0, failed: [] };

  // Respect the master email switch up front: fail cleanly without marking anyone
  // notified, so turning it back on and re-running still reaches everyone.
  if (!(await getEmailSendingEnabled())) {
    return {
      ok: false,
      error: "Email sending is turned off. Turn it on in Email settings before sending.",
      sent: 0,
      failed: [],
    };
  }

  const preview = await loadScheduleEmailPreview(groupId);
  if (!preview) return { ok: false, error: "Group not found.", sent: 0, failed: [] };

  const db = getDb();
  let sent = 0;
  const failed: { email: string; error: string }[] = [];

  for (const r of preview.recipients) {
    try {
      await sendScheduleCreatedEmail({ to: r.email, name: firstName(r.displayName) });
      // Stamp per-recipient right after a successful send so a crash mid-batch
      // never re-mails someone (the marker is the idempotency key).
      await db
        .update(submissions)
        .set({ scheduleEmailSentAt: new Date() })
        .where(eq(submissions.studentEmail, r.email));
      sent += 1;
    } catch (e) {
      failed.push({ email: r.email, error: e instanceof Error ? e.message : "send failed" });
    }
    await sleep(THROTTLE_MS);
  }

  revalidatePath("/admin/schedule-email");
  return { ok: true, sent, failed };
}
