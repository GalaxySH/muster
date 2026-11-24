"use server";

/**
 * Selecting the semester an admin works in (docs/semester-domains-plan.md
 * §2.9). It lives here, beside the resolver that reads the selection, because
 * the control is in the shared page header.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { terms } from "@/lib/db/schema";
import { TERM_COOKIE, currentTermId } from "./working";

/** How long a selection lasts before the admin is back on the current term. */
const SELECTION_SECONDS = 60 * 60 * 24 * 30;

/**
 * Select the semester this admin works in, on every page, until they select
 * another. Selecting the current one clears the selection, so the admin goes
 * back to following the current semester (and moves with it when a new one
 * starts). The cookie is only ever a request: `workingTermId` honours it for
 * an admin and for a term that exists, and for nobody else.
 */
export async function selectTerm(termId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const jar = await cookies();
  if (termId === (await currentTermId())) {
    jar.delete(TERM_COOKIE);
  } else {
    const [term] = await getDb()
      .select({ id: terms.id })
      .from(terms)
      .where(eq(terms.id, String(termId)))
      .limit(1);
    if (!term) return { ok: false, error: "That semester does not exist." };
    jar.set(TERM_COOKIE, term.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SELECTION_SECONDS,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
