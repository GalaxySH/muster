/**
 * Transactional email via Resend (PLAN §11). The app owns any tokens; Resend is
 * only the courier. Sends from the verified `re.hauge.rocks` domain (`EMAIL_FROM`).
 * In dev (no `RESEND_API_KEY`) messages are logged to the server console instead
 * of sent, so local/automated testing needs no real mailbox.
 *
 * `sendEmail` is the generic core; the `send*Email` helpers are template callers
 * (magic-link sign-in) so message copy lives in one place.
 */
import "server-only";
import { env } from "@/lib/env";
import { getEmailSendingEnabled } from "@/lib/settings";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Send one transactional email via Resend, or log it in dev. Throws on send failure. */
export async function sendEmail({ to, subject, text, html }: EmailMessage): Promise<void> {
  // Master switch (admin-set, /admin/email-settings): when off, nothing is sent.
  // This is the single choke point, so every sender obeys it.
  if (!(await getEmailSendingEnabled())) {
    console.log(`[email] sending is turned off; suppressed message to ${to}: "${subject}"`);
    return;
  }
  if (!env.RESEND_API_KEY) {
    console.log(`[email] no RESEND_API_KEY set. Would send to ${to}: "${subject}"\n${text}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 300)}`);
  }
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
    `It expires in 30 minutes and can be used once:\n\n${url}\n\n` +
    `If you didn't request this, you can ignore this email.`;
  const html =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>Use this link to sign in to GDEC Scheduling (Muster). It expires in 30 minutes and can be used once:</p>` +
    `<p><a href="${url}">Sign in to Muster</a></p>` +
    `<p style="color:#666">If you didn't request this, you can ignore this email.</p>`;

  await sendEmail({ to, subject: "Your GDEC Scheduling sign-in link", text, html });
}
