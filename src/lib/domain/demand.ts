/**
 * Computed high-demand indicator (PLAN §7 "future: auto-flag from live selection
 * counts", roadmap 2.5). Supersedes the old admin-set `highDemand` block flag.
 *
 * A (block × day) cell is high-demand once the position has enough submitted
 * responses and the share of responders who selected that cell crosses a
 * threshold. The signal stays opaque to students (a bare red bar) to avoid gaming;
 * only the rendering path is reused. Pure: the caller supplies aggregate counts.
 */
import type { Day } from "./types";

/** A position needs this many submitted responses before any signal shows. */
export const DEMAND_MIN_RESPONDERS = 20;
/** Share of responders (0..1) a cell must reach to count as high-demand. */
export const DEMAND_THRESHOLD = 0.6;

/** Distinct responders who selected a given (block × day) cell. */
export interface CellCount {
  blockId: string;
  day: Day;
  count: number;
}

export interface DemandOptions {
  minResponders?: number;
  threshold?: number;
}

export const demandCellKey = (blockId: string, day: Day) => `${blockId}|${day}`;

/** The (block × day) cells whose responder share meets the threshold. */
export function highDemandCells(
  counts: readonly CellCount[],
  responderCount: number,
  options: DemandOptions = {},
): Set<string> {
  const minResponders = options.minResponders ?? DEMAND_MIN_RESPONDERS;
  const threshold = options.threshold ?? DEMAND_THRESHOLD;
  const cells = new Set<string>();
  if (responderCount < minResponders || responderCount <= 0) return cells;
  for (const c of counts) {
    if (c.count / responderCount >= threshold) cells.add(demandCellKey(c.blockId, c.day));
  }
  return cells;
}

/**
 * Block ids to flag in the grid: a block is high-demand if any of its day cells is
 * (the reused red-bar rendering is per block row, PLAN §7). Uses the same counts,
 * so no key parsing.
 */
export function highDemandBlockIds(
  counts: readonly CellCount[],
  responderCount: number,
  options: DemandOptions = {},
): Set<string> {
  const cells = highDemandCells(counts, responderCount, options);
  const blocks = new Set<string>();
  for (const c of counts) {
    if (cells.has(demandCellKey(c.blockId, c.day))) blocks.add(c.blockId);
  }
  return blocks;
}
