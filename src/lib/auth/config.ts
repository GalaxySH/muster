/**
 * NextAuth (Auth.js v5) configuration — the Google sign-in path (PLAN.md §11).
 *
 * Sign-in scopes only (`openid email profile`), `hd=wisc.edu` hinted to Google
 * and enforced in the signIn callback. JWT sessions (no DB adapter): auth only
 * establishes identity; roster/student linking is a separate concern. Admin
 * status is derived from the allowlist at token time.
 */
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { env, adminEmails } from "@/lib/env";
import { WISC_DOMAIN, isAllowedGoogleSignIn, isAdminEmail } from "./policy";

export const authConfig: NextAuthConfig = {
  secret: env.AUTH_SECRET,
  trustHost: true, // behind Caddy in production
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // hd pre-filters the Google account chooser to the org; the signIn
      // callback is the actual gate.
      authorization: { params: { hd: WISC_DOMAIN, prompt: "select_account" } },
    }),
  ],
  callbacks: {
    signIn({ profile }) {
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
