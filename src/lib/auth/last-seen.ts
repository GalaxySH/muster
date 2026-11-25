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
 *     calls a single page render makes into at most one write per person per
 *     window. A single container fronts prod, so an in-memory map is enough; a
 *     restart just means the next request writes, which is harmless.
 *   - Each write is a single primary-key UPDATE, guarded so a signed-in email
 *     with no roster row (e.g. an env-allowlist admin) simply updates 0 rows,
 *     and any failure is swallowed: telemetry must never break auth.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings, students, termMembers } from "@/lib/db/schema";
import { SETTING_CURRENT_TERM_ID } from "@/lib/terms/term-id";
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
    // The same visit, counted for the semester being collected. Named by a
    // subquery so the stamp costs no extra read.
    await db
      .update(termMembers)
      .set({ lastSeenAt })
      .where(
        and(
          eq(termMembers.studentEmail, email),
          eq(
            termMembers.termId,
            sql`(select ${appSettings.value} from ${appSettings} where ${appSettings.key} = ${SETTING_CURRENT_TERM_ID})`,
          ),
        ),
      );
  } catch {
    // Let a later request retry rather than sitting out the whole window.
    lastWriteByEmail.delete(email);
  }
}
