/**
 * Loader for the login analytics surface (`/admin/analytics`). One thin row per
 * on-roster student (the same roster predicate the rest of the admin surfaces
 * use), joined to their submission status. All derivation is in the pure
 * `analytics-view.ts`.
 */
import "server-only";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, submissions } from "@/lib/db/schema";
import type { AnalyticsStudent } from "./analytics-view";
import { workingTerm } from "@/lib/terms/working";
import { submissionOfStudent, onRosterStudent } from "@/lib/terms/scope";

export async function loadAnalyticsStudents(): Promise<AnalyticsStudent[]> {
  // "Signed in" means in this semester: a visit from before it was started does
  // not count. The first semester was never started, so it has no stamp and
  // every visit counts.
  const { id: termId, activatedAt: since } = await workingTerm();
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      lastSeenAt: students.lastSeenAt,
      status: submissions.status,
    })
    .from(students)
    .leftJoin(submissions, submissionOfStudent(termId))
    .where(onRosterStudent(termId))
    .orderBy(asc(students.displayName), asc(students.email));

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    lastSeenAt: since && r.lastSeenAt && r.lastSeenAt < since ? null : r.lastSeenAt,
    status: r.status ?? null,
  }));
}
