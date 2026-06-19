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

/** DEV-LOGIN provider id, referenced by the dev sign-in action. */
export const DEV_LOGIN_PROVIDER = "dev-login";

const providers: Provider[] = [
  Google({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    // hd pre-filters the Google account chooser to the org; the signIn
    // callback is the actual gate.
    authorization: { params: { hd: WISC_DOMAIN, prompt: "select_account" } },
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
  trustHost: true, // behind Caddy in production
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  providers,
  callbacks: {
    signIn({ account, profile }) {
      // The dev-login provider gates itself in authorize(); allow it through.
      if (account?.provider === DEV_LOGIN_PROVIDER) return devLoginEnabled;
      return isAllowedGoogleSignIn({
        email: profile?.email,
        emailVerified: profile?.email_verified,
        hd: typeof profile?.hd === "string" ? profile.hd : null,
      });
    },
    jwt({ token }) {
      token.isAdmin = token.email ? isAdminEmail(token.email, adminEmails) : false;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.isAdmin = Boolean(token.isAdmin);
      }
      return session;
    },
  },
};
