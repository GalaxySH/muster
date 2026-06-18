/**
 * Maximum non-overlapping packing of time ranges within a single day.
 *
 * This is the core of the min-hours feasibility check (PLAN.md §5 #2, §8):
 * given the blocks a student selected on one day (which overlap/stagger), what
 * is the most total time that could actually be scheduled without two shifts
 * colliding? It's the classic weighted-interval-scheduling problem with
 * weight = duration.
 */
import { minutesBetween, type TimeRange } from "./time";

/** Max total minutes from a set of same-day ranges with no two overlapping. */
export function maxNonOverlappingMinutes(ranges: readonly TimeRange[]): number {
  if (ranges.length === 0) return 0;

  // Sort by end time so that for each interval i, all compatible predecessors
  // appear earlier in the array.
  const sorted = [...ranges].sort((a, b) => a.end - b.end);
  const n = sorted.length;

  // best[i] = max packed minutes considering only sorted[0..i].
  const best: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const current = sorted[i]!;
    const include = minutesBetween(current) + bestBefore(sorted, best, i, current.start);
    const exclude = i > 0 ? best[i - 1]! : 0;
    best[i] = Math.max(include, exclude);
  }
  return best[n - 1]!;
}

/** Best packing among intervals ending at or before `startBound` (compatible with the current one). */
function bestBefore(
  sorted: readonly TimeRange[],
  best: readonly number[],
  index: number,
  startBound: number,
): number {
  for (let j = index - 1; j >= 0; j--) {
    if (sorted[j]!.end <= startBound) {
      return best[j]!;
    }
  }
  return 0;
}
