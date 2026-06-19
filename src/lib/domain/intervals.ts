/**
 * Interval-union helpers over time ranges (PLAN.md §5 #2, §8).
 *
 * Shift blocks are defined to *stagger with small handoff overlaps* (e.g. a
 * 6:30a–10:15a block followed by 10a–12:45p), and they are also genuinely
 * back-to-back from a student's point of view. So "how many hours can this
 * student work?" is the total time their selected blocks *cover* — the union of
 * the ranges, with any overlap counted once and contiguous/touching ranges
 * merged into one span. (A strict non-overlapping packing would wrongly drop a
 * whole shift just because of a 15-minute handoff.)
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
