/**
 * Group membership for a term (PLAN.md §13, docs/semester-domains-plan.md §2.5).
 *
 * A student's group lives in `group_members`, one row per student per term, so
 * a new semester starts with nobody in a group and every form closed. This
 * file is the one reader and the one writer of that table.
 *
 * The writer also keeps the retired `students.group_id` and
 * `students.group_assigned_auto` columns in step. Nothing reads them any more;
 * they stay current only so the previous release still works if a deploy is
 * rolled back, and they go when the contract migration drops them.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { groupMembers, groups, students } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/terms/term-id";

/**
 * The ON clause for `students LEFT JOIN group_members`. Follow it with
 * `LEFT JOIN groups ON groups.id = group_members.group_id` to reach the group.
 */
export function membershipOf(termId: string) {
  return and(eq(groupMembers.studentEmail, students.email), eq(groupMembers.termId, termId));
}

/** WHERE test: the student is in the term's test-accounts group. */
export function inTestGroup(termId: string) {
  return sql`exists (select 1 from ${groupMembers} inner join ${groups} on ${groups.id} = ${groupMembers.groupId} where ${groupMembers.studentEmail} = ${students.email} and ${groupMembers.termId} = ${termId} and ${groups.kind} = 'test')`;
}

/** WHERE test: the student is in no group this term. */
export function inNoGroup(termId: string) {
  return sql`not exists (select 1 from ${groupMembers} where ${groupMembers.studentEmail} = ${students.email} and ${groupMembers.termId} = ${termId} and ${groupMembers.groupId} is not null)`;
}

/** WHERE test: the student is in this group. The group's own term scopes it. */
export function inGroup(groupId: string) {
  return sql`exists (select 1 from ${groupMembers} where ${groupMembers.studentEmail} = ${students.email} and ${groupMembers.groupId} = ${groupId})`;
}

/** One student's group in the term, or null when they are in none. */
export async function groupOf(
  db: DbOrTx,
  email: string,
  termId: string,
): Promise<typeof groups.$inferSelect | null> {
  const [row] = await db
    .select({ group: groups })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.studentEmail, email), eq(groupMembers.termId, termId)))
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
    .insert(groupMembers)
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
    .update(groupMembers)
    .set({ groupId: null })
    .where(and(eq(groupMembers.termId, termId), inArray(groupMembers.studentEmail, emails)));
  await db.update(students).set({ groupId: null }).where(inArray(students.email, emails));
}

/**
 * Who the default sweep should place: every student with no group this term
 * who was never auto-assigned in it.
 */
export async function listUnsweptEmails(db: DbOrTx, termId: string): Promise<string[]> {
  const rows = await db
    .select({ email: students.email })
    .from(students)
    .leftJoin(groupMembers, membershipOf(termId))
    .where(
      sql`${groupMembers.groupId} is null and coalesce(${groupMembers.assignedAuto}, false) = false`,
    );
  return rows.map((r) => r.email);
}
