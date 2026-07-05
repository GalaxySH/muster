/**
 * Shared admin gate for server actions. Admin is recomputed per request inside
 * getAppSession (env allowlist + admin_users table — never the JWT claim), so a
 * revoked admin is locked out immediately.
 */
import "server-only";
import { getAppSession } from "./session";

export type AdminGate = { ok: true; email: string } | { ok: false; error: string };

export async function requireAdmin(): Promise<AdminGate> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  if (!session.isAdmin) return { ok: false, error: "Admins only." };
  return { ok: true, email: session.email };
}
