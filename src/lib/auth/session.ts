/**
 * Auth-method-agnostic session abstraction (PLAN.md §11 "Implementation note").
 *
 * The rest of the app depends on AppSession, not on NextAuth directly, so the
 * magic-link fallback can later resolve to the same shape without touching
 * callers. Today it wraps the Google/NextAuth session.
 */
import { normalizeEmail } from "./policy";
import { auth } from "./index";
import { adminEmails } from "@/lib/env";
import { isAdminInDb } from "@/lib/roster/lookup";
import { recordSeen } from "./last-seen";

export interface AppSession {
  /** normalized wisc.edu email: the stable identity key (PLAN §9, §11). */
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
  // Admin is computed authoritatively on EVERY request from the current sources
  // of truth (the env allowlist and the roster-imported allowlist) and NEVER
  // trusts the JWT `isAdmin` claim as a positive grant. A JWT lives ~30 days, so
  // trusting the stamped claim would let a removed/compromised admin keep access
  // until their token expired; recomputing here makes revocation immediate.
  const isAdmin = adminEmails.has(normalized) || (await isAdminInDb(normalized));

  // Stamp last-seen for the analytics surface. Throttled and best-effort, so it
  // adds no real cost to most requests and never fails a session resolve.
  await recordSeen(normalized);

  return {
    email: normalized,
    name: session.user?.name ?? null,
    isAdmin,
    method: session.user?.method === "magic-link" ? "magic-link" : "google",
  };
}
