/**
 * How a query stays inside one term (docs/semester-domains-plan.md).
 *
 * A student has one submission per term, and everything hanging off it (picks,
 * the internal copy, proofs, travel, flags) is scoped by it. So the three
 * submission predicates are the whole of how form data stays inside a term. A
 * submissions read that uses none of them is reading every term, which is only
 * right when it already holds a submission id.
 *
 * The run, plan and close-claim predicates below them are the same idea for
 * the other per-term tables.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  closeClaims,
  closeSlots,
  scheduleRuns,
  shiftPlans,
  students,
  submissions,
  termMembers,
} from "@/lib/db/schema";

/** `.where(...)`: one student's submission in the term. */
export function submissionOf(studentEmail: string, termId: string) {
  return and(eq(submissions.studentEmail, studentEmail), eq(submissions.termId, termId));
}

/**
 * The ON clause for `students LEFT JOIN submissions`. The term test has to sit
 * here and not in the WHERE: a WHERE on the right side of a left join drops
 * every student who has not responded, and without it the join returns one row
 * per term a student ever submitted in.
 */
export function submissionOfStudent(termId: string) {
  return and(eq(submissions.studentEmail, students.email), eq(submissions.termId, termId));
}

/** For a query that reaches submissions another way (from a child row, or a full scan). */
export function submissionInTerm(termId: string) {
  return eq(submissions.termId, termId);
}

/**
 * The ON clause for `students JOIN term_members`: the person's place in the
 * term (position, roster flag, tracker title, group). `students` alone is only
 * the person, so any query that asks who is on the roster or what job someone
 * holds joins through this.
 *
 * Use an inner join for a list of the term's people: someone with no row was
 * never part of that term and does not belong in it. Use a left join only
 * where the person must come back regardless (a lookup by email).
 */
export function memberOf(termId: string) {
  return and(eq(termMembers.studentEmail, students.email), eq(termMembers.termId, termId));
}

/**
 * The same join from a submission: the place its student holds in the
 * submission's own term. For code that starts from a submission id.
 */
export function memberOfSubmission() {
  return and(
    eq(termMembers.studentEmail, submissions.studentEmail),
    eq(termMembers.termId, submissions.termId),
  );
}

/** `.where(...)` on a query that starts from `term_members`: the term's roster. */
export function rosterOf(termId: string) {
  return and(eq(termMembers.termId, termId), eq(termMembers.onRoster, true));
}

/**
 * WHERE test on a `students` query that has no reason to join: the person is
 * on the term's roster. Being listed on the imported tracker is what puts
 * someone on it, and dropping off it is what takes them off (PLAN §4.2).
 * Someone who left is not schedulable, so the generator, W2W and the console
 * all filter on this, and a missed copy readmits a departed student into a
 * coverage count, a schedule view or a W2W upload.
 */
export function onRosterStudent(termId: string) {
  return sql`exists (select 1 from ${termMembers} where ${termMembers.studentEmail} = ${students.email} and ${termMembers.termId} = ${termId} and ${termMembers.onRoster} = true)`;
}

/** The term's current schedule run. Each term has its own; there is no global one. */
export function currentRunOf(termId: string) {
  return and(eq(scheduleRuns.status, "current"), eq(scheduleRuns.termId, termId));
}

/** The term's current W2W shift plan. */
export function currentPlanOf(termId: string) {
  return and(eq(shiftPlans.status, "current"), eq(shiftPlans.termId, termId));
}

/**
 * A close claim belongs to the term of its slot. Claims carry no term column,
 * so a claims query that does not join close_slots uses this.
 */
export function closeClaimInTerm(termId: string) {
  return sql`${closeClaims.closeSlotId} in (select ${closeSlots.id} from ${closeSlots} where ${closeSlots.termId} = ${termId})`;
}
