/**
 * Pure throttle decision for last-seen recording, split from the I/O in
 * `last-seen.ts` so it stays testable without a DB (which `getDb` would drag in
 * as a server-only import).
 */

/** At most one last-seen write per person per this window. */
export const SEEN_THROTTLE_MS = 10 * 60 * 1000;

/**
 * Whether enough time has passed since the last recorded write to write again.
 */
export function shouldRecord(
  lastWriteMs: number | undefined,
  nowMs: number,
  throttleMs: number = SEEN_THROTTLE_MS,
): boolean {
  return lastWriteMs === undefined || nowMs - lastWriteMs >= throttleMs;
}
