/**
 * Transactional email via Resend (PLAN §11). The app owns any tokens; Resend is
 * only the courier. Sends from the verified `re.hauge.rocks` domain (`EMAIL_FROM`).
 * In dev (no `RESEND_API_KEY`) messages are logged to the server console instead
 * of sent, so local/automated testing needs no real mailbox. Outside production,
 * only addresses on EMAIL_TEST_RECIPIENTS are ever delivered to (./guard).
 *
 * `sendEmail` is the generic core; the `send*Email` helpers are template callers
 * (magic-link sign-in) so message copy lives in one place.
 */
import "server-only";
import { env } from "@/lib/env";
import { getEmailSendingEnabled } from "@/lib/settings";
import { guardRecipients, parseTestRecipients } from "./guard";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string[];
  replyTo?: string;
  /** Overrides EMAIL_FROM. Must be on the verified sending domain. */
  from?: string;
  /** Resend drops a repeat of the same key for 24 hours (double-click safety). */
  idempotencyKey?: string;
}

/**
 * What happened to a message: `sent` through Resend, `suppressed` by the
 * master switch, `logged` to the console (no API key), or `blocked` by the
 * test-recipient guard.
 */
export type EmailOutcome = "sent" | "suppressed" | "logged" | "blocked";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const testRecipients =
  process.env.NODE_ENV === "production" ? null : parseTestRecipients(env.EMAIL_TEST_RECIPIENTS);

/** Send one transactional email via Resend, or log it in dev. Throws on send failure. */
export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  const { subject, text, html, replyTo, from, idempotencyKey } = message;
  // Master switch (admin-set, /admin/email-settings): when off, nothing is sent.
  // This is the single choke point, so every sender obeys it.
  if (!(await getEmailSendingEnabled())) {
    console.log(`[email] sending is turned off; suppressed message to ${message.to}: "${subject}"`);
    return "suppressed";
  }
  const { to, cc, dropped } = guardRecipients(
    { to: message.to, cc: message.cc ?? [] },
    testRecipients,
  );
  if (dropped.length > 0) {
    console.log(`[email] not on EMAIL_TEST_RECIPIENTS, dropped: ${dropped.join(", ")}`);
  }
  if (!to) {
    console.log(`[email] blocked message to ${message.to}: "${subject}"
${text}`);
    return "blocked";
  }
  if (!env.RESEND_API_KEY) {
    console.log(`[email] no RESEND_API_KEY set. Would send to ${to}: "${subject}"
${text}`);
    return "logged";
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: from ?? env.EMAIL_FROM,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
      ...(cc.length ? { cc } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return "sent";
}

export interface MagicLinkEmail {
  to: string;
  url: string;
  name?: string;
}

/** Deliver a magic-link sign-in email (or log it in dev). Throws on send failure. */
export async function sendMagicLinkEmail({ to, url, name }: MagicLinkEmail): Promise<void> {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const text =
    `${greeting}\n\nUse this link to sign in to GDEC Scheduling (Muster). ` +
    `It expires in 1 day and can be used once:\n\n${url}\n\n` +
    `If you didn't request this, you can ignore this email.`;
  const html =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>Use this link to sign in to GDEC Scheduling (Muster). It expires in 1 day and can be used once:</p>` +
    `<p><a href="${url}">Sign in to Muster</a></p>` +
    `<p style="color:#666">If you didn't request this, you can ignore this email.</p>`;

  await sendEmail({ to, subject: "Your GDEC Scheduling sign-in link", text, html });
}
