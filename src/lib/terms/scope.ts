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
