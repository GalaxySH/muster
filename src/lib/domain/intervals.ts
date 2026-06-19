/**
 * Interval-union helpers over time ranges (PLAN.md §5 #2, §8).
 *
 * Shifts are assigned into designated blocks; an overlapping shift *extends* the
 * block rather than stacking on it. So "how many hours can this student work?"
 * is the time their selected blocks *cover* — the union of the ranges, where
 * overlapping or touching ranges merge into one continuous span and the shared
 * time is counted **once** (never double-counted). A 2p–5p block plus an
 * overlapping 4p–8p shift covers 2p–8p (6h), not 7h.
 */
import type { TimeRange } from "./time";

/** Merge overlapping or touching ranges into maximal spans (5p–end touches 5p–start). */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Total minutes covered by the union of the ranges (overlaps counted once). */
export function coveredMinutes(ranges: readonly TimeRange[]): number {
  return mergeRanges(ranges).reduce((sum, r) => sum + (r.end - r.start), 0);
}
