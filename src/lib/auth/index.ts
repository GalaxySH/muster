/**
 * NextAuth singleton. Import { auth, signIn, signOut, handlers } from here.
 * For the app's own session needs, prefer getAppSession() in ./session, which
 * is auth-method-agnostic (Google now, magic-link later, PLAN.md §11).
 */
import NextAuth from "next-auth";
import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
