/**
 * Each Shift Lead's own number of weekend closes for a term (PLAN.md §18a,
 * docs/semester-domains-plan.md §2.8).
 *
 * The term carries a default (`terms.close_requirement`). A lead's row in
 * `close_requirements` is made with the default as it stands at that moment and
 * keeps its number from then on, so changing the default only reaches leads who
 * arrive later. A lead with no row yet reads as the term default, never as
 * owing nothing.
 *
 * Plain (no `server-only`): the roster import and the position-change routine
 * run from the CLI as well as from the app.
 */
import { and, eq, isNull } from "drizzle-orm";
import { closeRequirements, positions, termMembers, terms } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/terms/term-id";

export interface CloseRequirement {
  /** How many closes this lead owes in the term. */
  required: number;
  /** False when the lead has no row yet and the term's default is standing in. */
  assigned: boolean;
}

/** This lead's own row for the term, as a join condition against `term_members`. */
export function requirementOfMember() {
  return and(
    eq(closeRequirements.termId, termMembers.termId),
    eq(closeRequirements.studentEmail, termMembers.studentEmail),
  );
}

/**
 * Give a row to everyone in the term who holds a position that picks closes
 * and has none, at the term's default. Rows that exist are never touched.
 *
 * It fills every gap rather than adding one person, on purpose: it runs
 * wherever someone can become a lead (a roster import, a position change, a
 * new test account, generating the inventory), and a call site that was
 * missed is healed by the next one. Returns how many rows it made.
 */
export async function ensureCloseRequirements(db: DbOrTx, termId: string): Promise<number> {
  const missing = await db
    .select({ email: termMembers.studentEmail, required: terms.closeRequirement })
    .from(termMembers)
    .innerJoin(positions, eq(positions.id, termMembers.positionId))
    .innerJoin(terms, eq(terms.id, termMembers.termId))
    .leftJoin(closeRequirements, requirementOfMember())
    .where(
      and(
        eq(termMembers.termId, termId),
        eq(positions.picksCloses, true),
        isNull(closeRequirements.studentEmail),
      ),
    );
  if (missing.length === 0) return 0;

  await db
    .insert(closeRequirements)
    .values(missing.map((m) => ({ termId, studentEmail: m.email, required: m.required })))
    // Someone else made the row first: theirs stands.
    .onDuplicateKeyUpdate({ set: { termId } });
  return missing.length;
}

/** One person's number for the term: their own row, or the term's default when they have none. */
export async function closeRequirementOf(
  db: DbOrTx,
  termId: string,
  email: string,
): Promise<CloseRequirement> {
  const [row] = await db
    .select({ own: closeRequirements.required, termDefault: terms.closeRequirement })
    .from(terms)
    .leftJoin(
      closeRequirements,
      and(eq(closeRequirements.termId, terms.id), eq(closeRequirements.studentEmail, email)),
    )
    .where(eq(terms.id, termId))
    .limit(1);
  if (!row) throw new Error(`No term ${termId}.`);
  return { required: row.own ?? row.termDefault, assigned: row.own !== null };
}
