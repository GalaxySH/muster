/**
 * Loader for the login analytics surface (`/admin/analytics`). One thin row per
 * on-roster student (the same roster predicate the rest of the admin surfaces
 * use), joined to their submission status. All derivation is in the pure
 * `analytics-view.ts`.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, submissions } from "@/lib/db/schema";
import type { AnalyticsStudent } from "./analytics-view";

export async function loadAnalyticsStudents(): Promise<AnalyticsStudent[]> {
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      lastSeenAt: students.lastSeenAt,
      status: submissions.status,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .where(eq(students.onRoster, true))
    .orderBy(asc(students.displayName), asc(students.email));

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    lastSeenAt: r.lastSeenAt,
    status: r.status ?? null,
  }));
}
