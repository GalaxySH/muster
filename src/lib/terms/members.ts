/**
 * The one writer of a person's roster place in a term: their position, whether
 * they are on the roster, and the tracker title they came in under
 * (docs/semester-domains-plan.md §2.3). The group on the same row is written by
 * lib/groups/membership.ts.
 *
 * A shared root like lib/db: plain, no `server-only`, because the roster import
 * and the dev scripts run from the CLI.
 */
import { and, eq, inArray } from "drizzle-orm";
import { termMembers } from "@/lib/db/schema";
import type { DbOrTx } from "./term-id";

export interface RosterPlace {
  positionId: string | null;
  onRoster: boolean;
  rosterTitle: string | null;
}

/** Create or replace one person's roster place in the term. Their group is left alone. */
export async function enrollMember(
  db: DbOrTx,
  termId: string,
  email: string,
  place: RosterPlace,
): Promise<void> {
  await db
    .insert(termMembers)
    .values({ termId, studentEmail: email, ...place })
    .onDuplicateKeyUpdate({ set: place });
}

/** Move people who already belong to the term onto a position. */
export async function setMemberPosition(
  db: DbOrTx,
  termId: string,
  emails: string[],
  positionId: string | null,
): Promise<void> {
  if (emails.length === 0) return;
  await db
    .update(termMembers)
    .set({ positionId })
    .where(and(eq(termMembers.termId, termId), inArray(termMembers.studentEmail, emails)));
}

/**
 * Take people off the term's roster. Only ever a flag, never a delete: the
 * name, position and any submission are kept, so someone listed again later
 * comes straight back.
 */
export async function takeOffRoster(db: DbOrTx, termId: string, emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db
    .update(termMembers)
    .set({ onRoster: false })
    .where(and(eq(termMembers.termId, termId), inArray(termMembers.studentEmail, emails)));
}
