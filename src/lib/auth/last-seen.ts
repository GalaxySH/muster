/**
 * Last-seen tracking: stamp `students.last_seen_at` on authenticated activity.
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
 *   - The write is a single primary-key UPDATE, guarded so a signed-in email
 *     with no roster row (e.g. an env-allowlist admin) simply updates 0 rows,
 *     and any failure is swallowed: telemetry must never break auth.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students } from "@/lib/db/schema";
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
    await getDb().update(students).set({ lastSeenAt: new Date() }).where(eq(students.email, email));
  } catch {
    // Let a later request retry rather than sitting out the whole window.
    lastWriteByEmail.delete(email);
  }
}
