"use server";

/**
 * Magic-link request + redemption server actions (PLAN §11).
 *
 * Request: best-effort issue+send, but the on-screen response is ALWAYS neutral
 * (no roster/enumeration leak). Eligibility = the email is a known student or
 * admin; throttled per-email. Redemption: hand the token+email to the
 * `magic-link` Credentials provider, which atomically consumes the token.
 */
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "./index";
import { normalizeEmail, isWiscEmail } from "./policy";
import {
  issueMagicLink,
  requestCooldownMs,
  isEligibleForMagicLink,
  inferRosterName,
} from "./magic-link-store";
import { sendMagicLinkEmail } from "@/lib/email/resend";
import { env } from "@/lib/env";
import { MAGIC_LINK_PROVIDER } from "./config";

export async function requestMagicLink(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  // Best-effort: only ever issue to an eligible address, once per cooldown. The
  // recipient's name is inferred from the roster (not collected). Any failure is
  // swallowed — the response below is identical regardless.
  try {
    if (
      isWiscEmail(email) &&
      (await isEligibleForMagicLink(email)) &&
      (await requestCooldownMs(email)) === 0
    ) {
      const name = (await inferRosterName(email)) ?? undefined;
      const token = await issueMagicLink(email);
      const url = `${env.NEXTAUTH_URL}/magic/redeem?token=${encodeURIComponent(token)}`;
      await sendMagicLinkEmail({ to: email, url, name });
    }
  } catch (e) {
    console.error("Magic-link request failed (non-fatal):", e);
  }

  // Neutral, constant-shape response — never reveal whether the address exists.
  redirect("/signin?sent=1");
}

export async function redeemAndSignIn(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "");

  try {
    await signIn(MAGIC_LINK_PROVIDER, { token, email, redirectTo: "/me" });
  } catch (error) {
    // A bad/expired token → CredentialsSignin (AuthError): show the error page.
    if (error instanceof AuthError) {
      redirect(`/magic/redeem?error=1&token=${encodeURIComponent(token)}`);
    }
    // Otherwise it's the success NEXT_REDIRECT thrown by signIn — let it through.
    throw error;
  }
}
