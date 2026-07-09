/**
 * Computed high-demand indicator (PLAN §7 "future: auto-flag from live selection
 * counts", roadmap 2.5). Supersedes the old admin-set `highDemand` block flag.
 *
 * A (block × day) cell is high-demand when it's among the most-picked shifts for its
 * position. We rank shifts by how many responders chose them and flag the busiest
 * share (relative, not an absolute cutoff): students over-select, so what matters is
 * which shifts stand out above the pack, not whether any single shift crosses a fixed
 * percentage of the whole cohort. Ranking is per day-type (weekday shifts compete with
 * weekday shifts) because weekend picks run lower and a global rank would bury them.
 * The signal stays opaque to students (a bare red bar) to avoid gaming; only the
 * rendering path is reused. Pure: the caller supplies aggregate counts.
 */
import { dayTypeOf, type Day } from "./types";

/** A position needs this many submitted responses before any signal shows. */
export const DEMAND_MIN_RESPONDERS = 20;
/** Fraction of a day-type's picked shifts (busiest first) flagged as high-demand. */
export const DEMAND_TOP_SHARE = 0.15;

/** Distinct responders who selected a given (block × day) cell. */
export interface CellCount {
  blockId: string;
  day: Day;
  count: number;
}

export interface DemandOptions {
  minResponders?: number;
  topShare?: number;
}

export const demandCellKey = (blockId: string, day: Day) => `${blockId}|${day}`;

/** The (block × day) cells among the busiest `topShare` of their day-type. */
export function highDemandCells(
  counts: readonly CellCount[],
  responderCount: number,
  options: DemandOptions = {},
): Set<string> {
  const minResponders = options.minResponders ?? DEMAND_MIN_RESPONDERS;
  const topShare = options.topShare ?? DEMAND_TOP_SHARE;
  const cells = new Set<string>();
  if (responderCount < minResponders || responderCount <= 0) return cells;

  // Group picked shifts by day-type, then rank within each group.
  const byDayType = new Map<string, CellCount[]>();
  for (const c of counts) {
    if (c.count <= 0) continue;
    const key = dayTypeOf(c.day);
    const group = byDayType.get(key);
    if (group) group.push(c);
    else byDayType.set(key, [c]);
  }

  for (const group of byDayType.values()) {
    const sorted = [...group].sort((a, b) => b.count - a.count);
    const k = Math.min(sorted.length, Math.max(1, Math.ceil(sorted.length * topShare)));
    // Include every shift at or above the count at the cutoff rank, so shifts tied at
    // the boundary are treated alike (deterministic, no dependence on sort order).
    const cutoff = sorted[k - 1]!.count;
    for (const c of group) {
      if (c.count >= cutoff) cells.add(demandCellKey(c.blockId, c.day));
    }
  }
  return cells;
}
