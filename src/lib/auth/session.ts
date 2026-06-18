/**
 * Auth-method-agnostic session abstraction (PLAN.md §11 "Implementation note").
 *
 * The rest of the app depends on AppSession, not on NextAuth directly, so the
 * magic-link fallback can later resolve to the same shape without touching
 * callers. Today it wraps the Google/NextAuth session.
 */
import { normalizeEmail } from "./policy";
import { auth } from "./index";
import { isAdminInDb } from "@/lib/roster/lookup";

export interface AppSession {
  /** normalized wisc.edu email — the stable identity key (PLAN §9, §11). */
  email: string;
  name: string | null;
  isAdmin: boolean;
  method: "google" | "magic-link";
}

/** Current session, or null if signed out. */
export async function getAppSession(): Promise<AppSession | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  const normalized = normalizeEmail(email);
  // Admin = env allowlist (carried on the JWT) OR the roster-imported allowlist.
  // Only hit the DB when the fast path didn't already grant admin.
  const isAdmin = session.user?.isAdmin === true || (await isAdminInDb(normalized));

  return {
    email: normalized,
    name: session.user?.name ?? null,
    isAdmin,
    method: "google",
  };
}
