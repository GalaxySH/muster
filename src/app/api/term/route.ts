/**
 * Selecting the semester an admin works in (docs/semester-domains-plan.md
 * §2.9): POST { termId }. The header's semester control calls it and then
 * reloads the page.
 *
 * A route handler, not a server action, on purpose. A server action that sets
 * a cookie makes Next re-render the open page in place with the new semester's
 * data before the reload runs, and a client component still holding the old
 * semester's state can throw during that render (the "client-side exception"
 * flash). A cookie set here changes nothing on the page until the reload.
 *
 * A cross-site form cannot drive it: the session cookie is SameSite=Lax, so a
 * cross-site POST arrives signed out, and a JSON body needs a CORS preflight.
 */
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { terms } from "@/lib/db/schema";
import { TERM_COOKIE, currentTermId } from "@/lib/terms/working";

export const dynamic = "force-dynamic";

/** How long a selection lasts before the admin is back on the current term. */
const SELECTION_SECONDS = 60 * 60 * 24 * 30;

/**
 * Select the semester this admin works in, on every page, until they select
 * another. Selecting the current one clears the selection, so the admin goes
 * back to following the current semester (and moves with it when a new one
 * starts). The cookie is only ever a request: `workingTermId` honours it for
 * an admin and for a term that exists, and for nobody else.
 */
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { termId?: unknown } | null;
  const termId = typeof body?.termId === "string" ? body.termId : "";

  const jar = await cookies();
  if (termId === (await currentTermId())) {
    jar.delete(TERM_COOKIE);
  } else {
    const [term] = await getDb()
      .select({ id: terms.id })
      .from(terms)
      .where(eq(terms.id, termId))
      .limit(1);
    if (!term) {
      return Response.json({ ok: false, error: "That semester does not exist." }, { status: 404 });
    }
    jar.set(TERM_COOKIE, term.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SELECTION_SECONDS,
    });
  }
  return Response.json({ ok: true });
}
