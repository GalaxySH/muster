/**
 * Last-seen tracking: stamp `students.last_seen_at` on authenticated activity,
 * and `term_members.last_seen_at` for the current term, so analytics for one
 * semester counts only the visits made while it was the one being collected.
 *
 * Called from `getAppSession` (the one seam every signed-in request passes
 * through, method-agnostic across Google / magic-link / dev-login), so a value
 * means the person has signed in at least once and marks their most recent
 * activity. The admin analytics surface reads it to tell who has yet to log in.
 *
 * Two things keep this off the hot path:
 *   - An in-process throttle (`shouldRecord`) collapses the many `getAppSession`
 *     calls a single page render makes into at most one stamp per person per
 *     window. A single container fronts prod, so an in-memory map is enough; a
 *     restart just means the next request writes, which is harmless.
 *   - A stamp is one plain read of the current term id and two UPDATEs keyed by
 *     email (and that id). A signed-in email with no roster row (e.g. an
 *     env-allowlist admin) simply updates 0 rows, and any failure is swallowed:
 *     telemetry must never break auth.
 *
 * The term id is read first and passed as a value, not named by a subquery in
 * the UPDATE: InnoDB would lock the pointer row the subquery reads, and starting
 * a semester holds that row FOR UPDATE, so sign-ins would wait on it.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, termMembers } from "@/lib/db/schema";
import { getCurrentTermId } from "@/lib/terms/term-id";
import { shouldRecord } from "./last-seen-throttle";

const lastWriteByEmail = new Map<string, number>();

/**
 * Record that `email` was just active, throttled and best-effort. `email` must
 * already be normalized (the caller in `getAppSession` normalizes first).
 */
export async function recordSeen(email: string): Promise<void> {
  const now = Date.now();
  if (!shouldRecord(lastWriteByEmail.get(email), now)) return;
  // Claim the window before awaiting so concurrent requests don't all write.
  lastWriteByEmail.set(email, now);
  try {
    const db = getDb();
    const lastSeenAt = new Date();
    await db.update(students).set({ lastSeenAt }).where(eq(students.email, email));
    // The same visit, counted for the semester being collected. This throws
    // when the pointer is missing, which the catch below swallows.
    const termId = await getCurrentTermId(db);
    await db
      .update(termMembers)
      .set({ lastSeenAt })
      .where(and(eq(termMembers.studentEmail, email), eq(termMembers.termId, termId)));
  } catch {
    // Let a later request retry rather than sitting out the whole window.
    lastWriteByEmail.delete(email);
  }
}
