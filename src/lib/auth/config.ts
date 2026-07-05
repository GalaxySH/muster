/**
 * NextAuth (Auth.js v5) configuration — the Google sign-in path (PLAN.md §11).
 *
 * Sign-in scopes only (`openid email profile`), `hd=wisc.edu` hinted to Google
 * and enforced in the signIn callback. JWT sessions (no DB adapter): auth only
 * establishes identity; roster/student linking is a separate concern. Admin
 * status is derived from the allowlist at token time.
 */
import type { NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { env, adminEmails, devLoginEnabled } from "@/lib/env";
import {
  WISC_DOMAIN,
  isAllowedGoogleSignIn,
  isAdminEmail,
  isWiscEmail,
  normalizeEmail,
} from "./policy";
import { redeemMagicLink } from "./magic-link-store";

/** DEV-LOGIN provider id, referenced by the dev sign-in action. */
export const DEV_LOGIN_PROVIDER = "dev-login";
/** Magic-link provider id, referenced by the redemption action (PLAN §11). */
export const MAGIC_LINK_PROVIDER = "magic-link";

/** Best-effort client IP from proxy headers (audited on redemption). */
function ipFromRequest(request: Request | undefined): string | null {
  const xff = request?.headers.get("x-forwarded-for");
  return xff ? (xff.split(",")[0]?.trim() ?? null) : null;
}

const providers: Provider[] = [
  Google({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    // hd pre-filters the Google account chooser to the org; the signIn
    // callback is the actual gate.
    authorization: { params: { hd: WISC_DOMAIN, prompt: "select_account" } },
  }),
  // Magic-link fallback (PLAN §11): the token is verified + atomically consumed
  // in redeemMagicLink; authorize returns the bound email on success.
  Credentials({
    id: MAGIC_LINK_PROVIDER,
    name: "Email link",
    credentials: { token: {}, email: {} },
    async authorize(creds, request) {
      const token = typeof creds?.token === "string" ? creds.token : "";
      const email = typeof creds?.email === "string" ? creds.email : "";
      if (!token || !email) return null;
      const redeemed = await redeemMagicLink({ token, email, ip: ipFromRequest(request) });
      return redeemed ? { id: redeemed, email: redeemed } : null;
    },
  }),
];

// DEV ONLY: a no-OAuth credentials path so local/automated testing can reach
// protected pages. Only registered when the bypass is active (never in prod).
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: DEV_LOGIN_PROVIDER,
      name: "Dev login",
      credentials: { email: { label: "Email", type: "email" } },
      authorize(creds) {
        if (!devLoginEnabled) return null; // belt-and-suspenders
        const raw = typeof creds?.email === "string" ? creds.email : "";
        const email = normalizeEmail(raw);
        if (!isWiscEmail(email)) return null;
        return { id: email, email, name: `${email.split("@")[0]} (dev)` };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  secret: env.AUTH_SECRET,
  trustHost: true, // behind the host Apache reverse proxy in production
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  providers,
  callbacks: {
    signIn({ account, profile }) {
      // The dev-login + magic-link providers gate themselves in authorize().
      if (account?.provider === DEV_LOGIN_PROVIDER) return devLoginEnabled;
      if (account?.provider === MAGIC_LINK_PROVIDER) return true;
      return isAllowedGoogleSignIn({
        email: profile?.email,
        emailVerified: profile?.email_verified,
        hd: typeof profile?.hd === "string" ? profile.hd : null,
      });
    },
    jwt({ token, account }) {
      // `account` is present only on initial sign-in; persist the method after.
      if (account?.provider === MAGIC_LINK_PROVIDER) token.method = "magic-link";
      else if (account?.provider) token.method = "google";
      token.isAdmin = token.email ? isAdminEmail(token.email, adminEmails) : false;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.method = token.method === "magic-link" ? "magic-link" : "google";
      }
      return session;
    },
  },
};
