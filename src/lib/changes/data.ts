/**
 * Server-side reads for schedule change requests (roadmap 3.1). Pure rules
 * (validation, rate cap) live in `domain/change-requests.ts`; the digest
 * pipeline is `./digest.ts`. Requests are independent of the availability
 * submission and are never window-gated.
 */
import "server-only";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { changeRequestFiles, changeRequests, students, terms } from "@/lib/db/schema";
import { CHANGE_REQUEST_WINDOW_MS, type ChangeRequestDay } from "@/lib/domain/change-requests";

export type ChangeRequestStatus = "open" | "withdrawn" | "resolved";

export interface ChangeRequestRow {
  id: string;
  day: ChangeRequestDay;
  shiftText: string;
  comment: string;
  permanent: boolean;
  status: ChangeRequestStatus;
  createdAt: Date;
}

/**
 * One student's requests in one term, newest first. The request form passes
 * the term it files in; the admin's per-student page passes the term being
 * worked in, the same one the queue lists.
 */
export async function listChangeRequests(
  email: string,
  termId: string,
): Promise<ChangeRequestRow[]> {
  const rows = await getDb()
    .select({
      id: changeRequests.id,
      day: changeRequests.day,
      shiftText: changeRequests.shiftText,
      comment: changeRequests.comment,
      permanent: changeRequests.permanent,
      status: changeRequests.status,
      createdAt: changeRequests.createdAt,
    })
    .from(changeRequests)
    .where(and(eq(changeRequests.studentEmail, email), eq(changeRequests.termId, termId)))
    .orderBy(desc(changeRequests.createdAt));
  return rows;
}

/**
 * The semester of a request linked to a student's admin page, when it is not
 * the one being worked in (the page lists only that one). Null for a request
 * in the working term, an unknown id, or another student's request.
 */
export async function requestInOtherTerm(
  email: string,
  requestId: string,
  workingTermId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await getDb()
    .select({ id: terms.id, name: terms.name })
    .from(changeRequests)
    .innerJoin(terms, eq(changeRequests.termId, terms.id))
    .where(and(eq(changeRequests.id, requestId), eq(changeRequests.studentEmail, email)))
    .limit(1);
  return row && row.id !== workingTermId ? row : null;
}

/**
 * Supporting-proof fileIds for one student's requests, keyed by request id
 * (only the per-student admin page renders them).
 */
export async function changeRequestFilesByRequest(
  email: string,
): Promise<Map<string, string[]>> {
  const rows = await getDb()
    .select({ requestId: changeRequestFiles.changeRequestId, fileId: changeRequestFiles.fileId })
    .from(changeRequestFiles)
    .innerJoin(changeRequests, eq(changeRequestFiles.changeRequestId, changeRequests.id))
    .where(eq(changeRequests.studentEmail, email))
    .orderBy(changeRequestFiles.id);
  const byRequest = new Map<string, string[]>();
  for (const r of rows) {
    const list = byRequest.get(r.requestId) ?? [];
    list.push(r.fileId);
    byRequest.set(r.requestId, list);
  }
  return byRequest;
}

/**
 * Every Drive fileId attached to a student's change requests. Callers deleting
 * the student gather these BEFORE the delete cascades the rows away, then
 * best-effort relayDelete each (same pattern as submission proofs).
 */
export async function collectChangeRequestDriveFileIds(email: string): Promise<string[]> {
  const rows = await getDb()
    .select({ fileId: changeRequestFiles.fileId })
    .from(changeRequestFiles)
    .innerJoin(changeRequests, eq(changeRequestFiles.changeRequestId, changeRequests.id))
    .where(eq(changeRequests.studentEmail, email));
  return rows.map((r) => r.fileId);
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
  day: ChangeRequestDay;
  shiftText: string;
  comment: string;
  permanent: boolean;
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
  permanent: changeRequests.permanent,
  status: changeRequests.status,
  createdAt: changeRequests.createdAt,
});

/**
 * The admin queue for one term, oldest first: open requests, plus resolved
 * ones when the show-resolved toggle is on. Withdrawn requests never appear
 * (the student pulled them back).
 */
export async function listChangeRequestQueue(
  termId: string,
  includeResolved: boolean,
): Promise<AdminChangeRequest[]> {
  return getDb()
    .select(adminRequestColumns())
    .from(changeRequests)
    .innerJoin(students, eq(changeRequests.studentEmail, students.email))
    .where(
      and(
        eq(changeRequests.termId, termId),
        includeResolved
          ? ne(changeRequests.status, "withdrawn")
          : eq(changeRequests.status, "open"),
      ),
    )
    .orderBy(changeRequests.createdAt);
}

/**
 * One term's open requests not yet reported in a digest, oldest first
 * (roadmap 3.1). The digest passes the current term. An earlier term's
 * unreported requests are never emailed; they stay in that term's queue.
 */
export async function loadPendingDigestRequests(termId: string): Promise<AdminChangeRequest[]> {
  return getDb()
    .select(adminRequestColumns())
    .from(changeRequests)
    .innerJoin(students, eq(changeRequests.studentEmail, students.email))
    .where(
      and(
        eq(changeRequests.termId, termId),
        eq(changeRequests.status, "open"),
        isNull(changeRequests.digestSentAt),
      ),
    )
    .orderBy(changeRequests.createdAt);
}
