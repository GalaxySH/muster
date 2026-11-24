/**
 * Group membership for a term (PLAN.md §13, docs/semester-domains-plan.md §2.5).
 *
 * A student's group lives on their `term_members` row, one row per person per
 * term, so a new semester starts with nobody in a group and every form closed.
 * This file is the one reader and the one writer of the group on that row. The
 * roster place on the same row (position, roster flag) is written by
 * lib/terms/members.ts, and joined through `memberOf` in lib/terms/scope.ts.
 *
 * The writer also keeps the retired `students.group_id` and
 * `students.group_assigned_auto` columns in step. Nothing reads them any more;
 * they stay current only so the previous release still works if a deploy is
 * rolled back, and they go when the contract migration drops them.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { termMembers, groups, students } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/terms/term-id";

/** WHERE test: the student is in the term's test-accounts group. */
export function inTestGroup(termId: string) {
  return sql`exists (select 1 from ${termMembers} inner join ${groups} on ${groups.id} = ${termMembers.groupId} where ${termMembers.studentEmail} = ${students.email} and ${termMembers.termId} = ${termId} and ${groups.kind} = 'test')`;
}

/** WHERE test: the student is in no group this term. */
export function inNoGroup(termId: string) {
  return sql`not exists (select 1 from ${termMembers} where ${termMembers.studentEmail} = ${students.email} and ${termMembers.termId} = ${termId} and ${termMembers.groupId} is not null)`;
}

/** WHERE test: the student is in this group. The group's own term scopes it. */
export function inGroup(groupId: string) {
  return sql`exists (select 1 from ${termMembers} where ${termMembers.studentEmail} = ${students.email} and ${termMembers.groupId} = ${groupId})`;
}

/** One student's group in the term, or null when they are in none. */
export async function groupOf(
  db: DbOrTx,
  email: string,
  termId: string,
): Promise<typeof groups.$inferSelect | null> {
  const [row] = await db
    .select({ group: groups })
    .from(termMembers)
    .innerJoin(groups, eq(groups.id, termMembers.groupId))
    .where(and(eq(termMembers.studentEmail, email), eq(termMembers.termId, termId)))
    .limit(1);
  return row?.group ?? null;
}

/**
 * Put students in a group for the term. `assignedAuto` says who did it: false
 * for an admin's manual assignment (which clears the sticky marker), true for
 * the default sweep and the self-add hook.
 */
export async function assignMembers(
  db: DbOrTx,
  termId: string,
  emails: string[],
  groupId: string,
  assignedAuto: boolean,
): Promise<void> {
  if (emails.length === 0) return;
  await db
    .insert(termMembers)
    .values(emails.map((studentEmail) => ({ termId, studentEmail, groupId, assignedAuto })))
    .onDuplicateKeyUpdate({ set: { groupId, assignedAuto } });
  await db
    .update(students)
    .set({ groupId, groupAssignedAuto: assignedAuto })
    .where(inArray(students.email, emails));
}

/**
 * Take students out of their group for the term. Their row stays, so a student
 * the sweep once placed keeps the marker and is not swept straight back in.
 */
export async function unassignMembers(db: DbOrTx, termId: string, emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db
    .update(termMembers)
    .set({ groupId: null })
    .where(and(eq(termMembers.termId, termId), inArray(termMembers.studentEmail, emails)));
  await db.update(students).set({ groupId: null }).where(inArray(students.email, emails));
}

/**
 * Who the default sweep should place: everyone who belongs to the term, has no
 * group in it and was never auto-assigned in it. Someone with no place in the
 * term is not swept: they are not one of its students.
 */
export async function listUnsweptEmails(db: DbOrTx, termId: string): Promise<string[]> {
  const rows = await db
    .select({ email: termMembers.studentEmail })
    .from(termMembers)
    .where(
      and(
        eq(termMembers.termId, termId),
        isNull(termMembers.groupId),
        eq(termMembers.assignedAuto, false),
      ),
    );
  return rows.map((r) => r.email);
}
