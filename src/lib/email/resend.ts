/**
 * Transactional email via Resend (PLAN §11). The app owns the magic-link token;
 * Resend is only the courier. Sends from the verified `re.hauge.rocks` domain
 * (`EMAIL_FROM`). In dev (no `RESEND_API_KEY`) the link is logged to the server
 * console instead of sent, so local/automated testing needs no real mailbox.
 */
import "server-only";
import { env } from "@/lib/env";

export interface MagicLinkEmail {
  to: string;
  url: string;
  name?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Deliver a magic-link sign-in email (or log it in dev). Throws on send failure. */
export async function sendMagicLinkEmail({ to, url, name }: MagicLinkEmail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[magic-link] no RESEND_API_KEY set, link for ${to}:\n${url}`);
    return;
  }

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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: "Your GDEC Scheduling sign-in link",
      text,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 300)}`);
  }
}
