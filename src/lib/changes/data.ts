/**
 * Server-side reads for schedule change requests (roadmap 3.1). Pure rules
 * (validation, rate cap) live in `domain/change-requests.ts`; the digest
 * pipeline is `./digest.ts`. Requests are independent of the availability
 * submission and are never window-gated.
 */
import "server-only";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { changeRequests, students } from "@/lib/db/schema";
import { CHANGE_REQUEST_WINDOW_MS } from "@/lib/domain/change-requests";
import type { Day } from "@/lib/domain/types";

export type ChangeRequestStatus = "open" | "withdrawn" | "resolved";

export interface ChangeRequestRow {
  id: string;
  day: Day;
  shiftText: string;
  comment: string;
  status: ChangeRequestStatus;
  createdAt: Date;
}

/** One student's requests, newest first (drives both the student and admin lists). */
export async function listChangeRequests(email: string): Promise<ChangeRequestRow[]> {
  const rows = await getDb()
    .select({
      id: changeRequests.id,
      day: changeRequests.day,
      shiftText: changeRequests.shiftText,
      comment: changeRequests.comment,
      status: changeRequests.status,
      createdAt: changeRequests.createdAt,
    })
    .from(changeRequests)
    .where(eq(changeRequests.studentEmail, email))
    .orderBy(desc(changeRequests.createdAt));
  return rows;
}

/** Creation times inside the rolling rate window (for the pure rate check). */
export async function recentChangeRequestTimes(email: string, now: Date): Promise<Date[]> {
  const windowStart = new Date(now.getTime() - CHANGE_REQUEST_WINDOW_MS);
  const rows = await getDb()
    .select({ createdAt: changeRequests.createdAt })
    .from(changeRequests)
    .where(and(eq(changeRequests.studentEmail, email), gt(changeRequests.createdAt, windowStart)));
  return rows.map((r) => r.createdAt);
}

export interface AdminChangeRequest {
  id: string;
  studentEmail: string;
  studentName: string;
  day: Day;
  shiftText: string;
  comment: string;
  status: ChangeRequestStatus;
  createdAt: Date;
}

const adminRequestColumns = () => ({
  id: changeRequests.id,
  studentEmail: changeRequests.studentEmail,
  studentName: students.displayName,
  day: changeRequests.day,
  shiftText: changeRequests.shiftText,
  comment: changeRequests.comment,
  status: changeRequests.status,
  createdAt: changeRequests.createdAt,
});

/**
 * The admin queue, oldest first: open requests, plus resolved ones when the
 * show-resolved toggle is on. Withdrawn requests never appear (the student
 * pulled them back).
 */
export async function listChangeRequestQueue(
  includeResolved: boolean,
): Promise<AdminChangeRequest[]> {
  return getDb()
    .select(adminRequestColumns())
    .from(changeRequests)
    .innerJoin(students, eq(changeRequests.studentEmail, students.email))
    .where(
      includeResolved
        ? ne(changeRequests.status, "withdrawn")
        : eq(changeRequests.status, "open"),
    )
    .orderBy(changeRequests.createdAt);
}

/** Open requests not yet reported in a digest, oldest first (§roadmap 3.1). */
export async function loadPendingDigestRequests(): Promise<AdminChangeRequest[]> {
  return getDb()
    .select(adminRequestColumns())
    .from(changeRequests)
    .innerJoin(students, eq(changeRequests.studentEmail, students.email))
    .where(and(eq(changeRequests.status, "open"), isNull(changeRequests.digestSentAt)))
    .orderBy(changeRequests.createdAt);
}
