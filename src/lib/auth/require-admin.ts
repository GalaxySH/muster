/**
 * Shared admin gate for server actions. Admin is recomputed per request inside
 * getAppSession (env allowlist + admin_users table, never the JWT claim), so a
 * revoked admin is locked out immediately.
 */
import "server-only";
import { getAppSession } from "./session";
import { workingTermId } from "@/lib/terms/working";

export type AdminGate = { ok: true; email: string } | { ok: false; error: string };

export async function requireAdmin(): Promise<AdminGate> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  if (!session.isAdmin) return { ok: false, error: "Admins only." };
  return { ok: true, email: session.email };
}

/**
 * The gate for an action that acts on a whole semester and names no row of it
 * (the roster import, generating a schedule or the close inventory, saving the
 * semester's own settings). The selected semester belongs to the browser, not
 * the tab, so the page that sent this may be showing a semester the admin has
 * since left. The page says which one it was rendered for, and anything else is
 * refused (docs/semester-domains-plan.md §2.9). The same goes for an action
 * that names a person by email, because the same person is in both semesters.
 * Actions that name a row of the semester are already safe: the row is looked
 * up inside the working semester.
 */
export async function requireAdminIn(renderedTermId: string): Promise<AdminGate> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!(await isWorkingTerm(renderedTermId))) return { ok: false, error: STALE_TERM_MESSAGE };
  return gate;
}

export const STALE_TERM_MESSAGE =
  "This page is showing a different semester. Reload it and try again.";

/** True when the page that sent an action was rendered for the term being worked in. */
export async function isWorkingTerm(renderedTermId: string | undefined): Promise<boolean> {
  return Boolean(renderedTermId) && renderedTermId === (await workingTermId());
}
