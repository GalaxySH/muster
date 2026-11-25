/**
 * The term a request works in (docs/semester-domains-plan.md §2.9).
 *
 * Two terms have names here, and they are different things:
 *
 * - The **current term** is the one being collected, named by the pointer in
 *   app_settings. Every student reads and writes it.
 * - The **working term** is the one this request reads and writes. For a student
 *   it is always the current term. For an admin it is the term they selected, or
 *   the current term when they selected none.
 *
 * Pages and actions learn their term here and take no term id from the client,
 * so this file is the whole of how a request learns its term. The few things
 * that must follow the current term whatever is selected call `currentTermId()`
 * and say why. Anything that takes a database handle or a transaction (the
 * roster import, the position change path, the scripts) takes the term id as an
 * argument instead.
 *
 * Both are memoized with React `cache`, and that memo only holds while Server
 * Components render: a page that calls several loaders resolves the term once.
 * A server action or a route handler gets no memo at all, so it resolves the
 * term once at its top (usually in its gate) and passes that id down to every
 * helper it calls. Resolving again partway through could land in a new
 * semester started in the meantime.
 */
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { terms } from "@/lib/db/schema";
import { chooseWorkingTerm } from "@/lib/domain/terms";
import { getCurrentTermId, getTerm } from "./term-id";

/** Holds the term an admin selected. httpOnly; only `selectTerm` writes it. */
export const TERM_COOKIE = "muster_term";

/** The term being collected. Fails closed when the pointer is broken. */
export const currentTermId = cache((): Promise<string> => getCurrentTermId(getDb()));

/**
 * The selection cookie's value, or null. Work with no request behind it (the
 * digest scheduler, a script) has no cookies and so follows the current term.
 */
async function selectedTermId(): Promise<string | null> {
  try {
    return (await cookies()).get(TERM_COOKIE)?.value || null;
  } catch (error) {
    // Next signals "this page is dynamic" by throwing; that must pass through.
    unstable_rethrow(error);
    return null;
  }
}

export const workingTermId = cache(async (): Promise<string> => {
  // The cookie read comes first for the build's sake: it is what tells Next the
  // page belongs to a request, before anything touches the database. The
  // pointer is still read every time, so a broken one fails closed even with a
  // selection.
  const selected = await selectedTermId();
  const current = await currentTermId();
  if (!selected || selected === current) return current;

  // Only reached when a selection cookie is present, so a student's request
  // (which never carries one) costs nothing extra. Imported here, not at the
  // top: the session module loads the whole sign-in setup, and it reads the
  // roster, which reads this file.
  const { getAppSession } = await import("@/lib/auth/session");
  const [session, [known]] = await Promise.all([
    getAppSession(),
    getDb().select({ id: terms.id }).from(terms).where(eq(terms.id, selected)).limit(1),
  ]);
  return chooseWorkingTerm({
    current,
    selected,
    isAdmin: session?.isAdmin ?? false,
    selectedExists: Boolean(known),
  });
});

export type Term = typeof terms.$inferSelect;

/** The working term's row: its name, dates, travel cutoff and the rest. */
export const workingTerm = cache(
  async (): Promise<Term> => getTerm(getDb(), await workingTermId()),
);

/** Every term, newest first: the header's semester control lists these. */
export async function listTerms(): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: terms.id, name: terms.name })
    .from(terms)
    .orderBy(desc(terms.startsOn));
}

/** Every other term's name. The Semester page checks saved copy against them. */
export async function listOtherTermNames(): Promise<string[]> {
  const rows = await getDb()
    .select({ name: terms.name })
    .from(terms)
    .where(ne(terms.id, await workingTermId()));
  return rows.map((r) => r.name);
}
