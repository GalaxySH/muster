/**
 * Loader for the login analytics surface (`/admin/analytics`). One thin row per
 * on-roster student (the same roster predicate the rest of the admin surfaces
 * use), joined to their submission status. All derivation is in the pure
 * `analytics-view.ts`.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, submissions, termMembers } from "@/lib/db/schema";
import type { AnalyticsStudent } from "./analytics-view";
import { workingTermId } from "@/lib/terms/working";
import { memberOf, submissionOfStudent } from "@/lib/terms/scope";

export async function loadAnalyticsStudents(): Promise<AnalyticsStudent[]> {
  // "Signed in" means in this semester: the stamp on the person's place in the
  // term, which only moves while the term is the current one.
  const termId = await workingTermId();
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      lastSeenAt: termMembers.lastSeenAt,
      status: submissions.status,
    })
    .from(students)
    .innerJoin(termMembers, memberOf(termId))
    .leftJoin(submissions, submissionOfStudent(termId))
    .where(eq(termMembers.onRoster, true))
    .orderBy(asc(students.displayName), asc(students.email));

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    lastSeenAt: r.lastSeenAt,
    status: r.status ?? null,
  }));
}
