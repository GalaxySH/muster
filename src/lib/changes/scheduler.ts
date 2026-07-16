/**
 * The in-app change-digest scheduler: a tick loop started once per server
 * process from src/instrumentation.ts (production always; dev only behind
 * DIGEST_SCHEDULER_DEV). There is no host cron; the token-authenticated
 * /api/cron/change-digest route remains as a manual fallback trigger.
 *
 * Each tick asks the pure isDigestDue whether a daily run is owed, then takes
 * an atomic claim on the last-run key before sending, so a second process
 * pointed at the same DB (or an overlapping tick) can never double-send. A
 * failed tick just logs: the next tick retries because nothing was stamped.
 */
import "server-only";
import { claimChangeDigestRun, getChangeDigestLastRun } from "@/lib/settings";
import { isDigestDue } from "./digest-schedule";
import { runChangeDigest } from "./digest";

export const DIGEST_TICK_MS = 5 * 60 * 1000;

const globalMarker = globalThis as typeof globalThis & {
  __musterDigestSchedulerStarted?: boolean;
};

/** Idempotent: safe if a dev reload evaluates the entry point twice. */
export function startChangeDigestScheduler(): void {
  if (globalMarker.__musterDigestSchedulerStarted) return;
  globalMarker.__musterDigestSchedulerStarted = true;
  console.log(`Change-digest scheduler started (checks every ${DIGEST_TICK_MS / 60000} min).`);
  // Immediate first tick so a restart that slept through send time catches up
  // right away instead of one interval later.
  void digestTick();
  setInterval(() => void digestTick(), DIGEST_TICK_MS).unref();
}

export type DigestTickOutcome = "not-due" | "lost-claim" | "ran" | "error";

/** One scheduler pass; exported for tests, never throws. */
export async function digestTick(now: Date = new Date()): Promise<DigestTickOutcome> {
  try {
    const lastRun = await getChangeDigestLastRun();
    if (!isDigestDue(lastRun, now)) return "not-due";
    if (!(await claimChangeDigestRun(lastRun, now))) return "lost-claim";
    const result = await runChangeDigest(now);
    console.log("Change digest ran:", JSON.stringify(result));
    return "ran";
  } catch (e) {
    console.error("Change-digest scheduler tick failed:", e);
    return "error";
  }
}
