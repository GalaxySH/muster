/**
 * Per-submission caps on evidence rows (abuse guard, PLAN.md §7b/§12).
 *
 * Every extracurricular file and travel request relays a file (up to
 * MAX_EVIDENCE_BYTES) into the shared department Drive and inserts a DB row on
 * each call. Without a cap, a single student inside their edit window could
 * upload unbounded files, exhausting the Shared Drive quota and flooding the DB.
 * These constants bound how many rows one submission may hold per kind.
 */
export const MAX_EXTRACURRICULAR_FILES = 10;
export const MAX_TRAVEL_REQUESTS = 20;

/**
 * Whether a submission already holding `count` rows has reached `cap` — i.e.
 * adding one more would exceed the cap, so the new upload must be refused.
 */
export function isAtEvidenceCap(count: number, cap: number): boolean {
  return count >= cap;
}
