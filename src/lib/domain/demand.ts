/**
 * Computed high-demand indicator (PLAN §7 "future: auto-flag from live selection
 * counts", roadmap 2.5). Supersedes the old admin-set `highDemand` block flag.
 *
 * A (block × day) cell is high-demand when it is one of the most *contended* shifts
 * for its position. Two floors and one ranking:
 *   - Target floor: it has at least its block's target staffing (desiredCapacity) in
 *     takers. We never steer students off an under-staffed cell, only off ones that
 *     already have enough people.
 *   - Absolute floor: it has at least `minCellCount` takers regardless of target, so a
 *     thin cohort (or a tiny target) can't flag a shift off one or two picks.
 *   - Ranking: among the cells that clear both floors, flag the busiest `topShare` of
 *     their day-type by CONTENTION (takers ÷ target), not raw popularity: a shift that
 *     needs 2 people and 6 want it is harder to get than one that needs 6 and 6 want
 *     it, even though the second has more takers. Ranking is per day-type (weekday
 *     competes with weekday) because weekend picks run lower and a global rank would
 *     bury them.
 *
 * There is no cohort-size floor: gating is per cell, so a small position (e.g. Shift
 * Leads) still shows a signal without waiting for a large number of submissions.
 *
 * The signal stays opaque to students (a bare red bar) to avoid gaming; only the
 * rendering path is reused. Pure: the caller supplies aggregate counts and targets.
 */
import { dayTypeOf, type Day } from "./types";

/** Fraction of a day-type's eligible shifts (most contended first) flagged as high-demand. */
export const DEMAND_TOP_SHARE = 0.25;
/** A cell needs at least this many takers before it can flag, whatever its target. */
export const DEMAND_MIN_CELL_COUNT = 3;

/** Distinct responders who selected a given (block × day) cell. */
export interface CellCount {
  blockId: string;
  day: Day;
  count: number;
}

export interface DemandOptions {
  topShare?: number;
  minCellCount?: number;
  /**
   * blockId -> target staffing (desiredCapacity). A block absent from the map, or
   * mapped to null, has no target: it is floored by the absolute minimum alone and
   * ranked by takers relative to that minimum.
   */
  targets?: ReadonlyMap<string, number | null>;
}

export const demandCellKey = (blockId: string, day: Day) => `${blockId}|${day}`;

interface RankedCell extends CellCount {
  ratio: number;
}

/** The (block × day) cells that clear the floors and rank in the busiest `topShare` of their day-type. */
export function highDemandCells(
  counts: readonly CellCount[],
  options: DemandOptions = {},
): Set<string> {
  const topShare = options.topShare ?? DEMAND_TOP_SHARE;
  const minCellCount = options.minCellCount ?? DEMAND_MIN_CELL_COUNT;
  const targets = options.targets;
  const cells = new Set<string>();

  // Clear both floors, then carry each cell's contention ratio for ranking.
  const eligible: RankedCell[] = [];
  for (const c of counts) {
    const target = targets?.get(c.blockId) ?? null;
    // Target floor and absolute floor combined: count must reach the larger of the two.
    if (c.count < Math.max(minCellCount, target ?? 0)) continue;
    // With no target, rank by takers relative to the absolute floor so a no-target
    // position still orders its cells by how busy they are.
    const ratio = c.count / (target ?? minCellCount);
    eligible.push({ ...c, ratio });
  }

  // Group by day-type, then rank within each group by contention.
  const byDayType = new Map<string, RankedCell[]>();
  for (const c of eligible) {
    const key = dayTypeOf(c.day);
    const group = byDayType.get(key);
    if (group) group.push(c);
    else byDayType.set(key, [c]);
  }

  for (const group of byDayType.values()) {
    const sorted = [...group].sort((a, b) => b.ratio - a.ratio || b.count - a.count);
    const k = Math.min(sorted.length, Math.max(1, Math.ceil(sorted.length * topShare)));
    // Include every shift at or above the contention at the cutoff rank, so shifts
    // tied at the boundary are treated alike (deterministic, no dependence on sort order).
    const cutoff = sorted[k - 1]!.ratio;
    for (const c of group) {
      if (c.ratio >= cutoff) cells.add(demandCellKey(c.blockId, c.day));
    }
  }
  return cells;
}
