/**
 * The current term for the request being served. Memoized with React `cache`,
 * so a page that calls several loaders reads the pointer once.
 *
 * Request-side loaders and actions call this themselves: they are defined as
 * "the current term's" data, and no server action takes a term id from the
 * client, so there is no code path that writes to another term. Anything that
 * takes a database handle or a transaction (the roster import, the position
 * change path, the scripts) takes the term id as an argument instead.
 */
import "server-only";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { eq } from "drizzle-orm";
import { terms } from "@/lib/db/schema";
import { getCurrentTermId } from "./term-id";

export const currentTermId = cache((): Promise<string> => getCurrentTermId(getDb()));

/** The current term's row: its name, dates, travel cutoff and the rest. */
export type Term = typeof terms.$inferSelect;

/**
 * The current term itself, for the code that needs its dates and rules. Throws
 * when the pointer names a term that does not exist, for the same reason the
 * id read does: a broken install must fail closed.
 */
export const currentTerm = cache(async (): Promise<Term> => {
  const termId = await currentTermId();
  const [term] = await getDb().select().from(terms).where(eq(terms.id, termId)).limit(1);
  if (!term) throw new Error(`The current term "${termId}" does not exist.`);
  return term;
});
