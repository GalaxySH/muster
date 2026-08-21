/**
 * Schedule coverage view-model (roadmap 5.1; docs/schedule-generation-plan.md
 * Phase A): supply vs target per (block × day) cell.
 *
 * "Supply" is how many submitted students could work a cell, counted from
 * shift selections. Unlike domain/demand.ts (which ranks student *preferences*
 * and so excludes machine-assigned weekend cells), coverage asks who can be
 * scheduled, so auto-assigned cells count; the caller's query decides that.
 * Against each count stands the block's admin-set desiredCapacity; blocks
 * without a target get a plain count and no shortfall status.
 *
 * The lateness tier is derived from the block's end time, mirroring the
 * priority the future generator gives late shifts. Pure: callers supply
 * blocks and aggregate counts.
 */
import { deriveOpenClose } from "../blocks";
import { demandCellKey, type CellCount } from "../demand";
import { WEEKDAY_DAYS, WEEKEND_DAYS, type Day, type DayType, type ShiftBlock } from "../types";

/** Blocks ending at or after 8pm: the shifts hardest to keep staffed. */
export const NIGHT_END_MINUTES = 20 * 60;
/** Blocks ending at or after 5pm. */
export const EVENING_END_MINUTES = 17 * 60;

export type LatenessTier = "night" | "evening" | "day";

/** Tier a block by when it ends; later shifts staff up first (plan §3.2). */
export function latenessTier(endMinutes: number): LatenessTier {
  if (endMinutes >= NIGHT_END_MINUTES) return "night";
  if (endMinutes >= EVENING_END_MINUTES) return "evening";
  return "day";
}

export type CoverageStatus = "ok" | "short" | "severe" | "none";

export interface CoverageCell {
  day: Day;
  /** Distinct submitted students who could work this cell. */
  count: number;
  target: number | null;
  status: CoverageStatus;
}

export interface CoverageRow {
  blockId: string;
  dayType: DayType;
  start: number;
  end: number;
  target: number | null;
  tier: LatenessTier;
  /** The derived closing block of its day-type (latest end). */
  isClose: boolean;
  cells: CoverageCell[];
}

/** Cell status against a target: severe when under half, short when under. */
export function coverageStatus(count: number, target: number | null): CoverageStatus {
  if (target === null) return "none";
  if (count >= target) return "ok";
  return count * 2 < target ? "severe" : "short";
}

/**
 * One row per block (weekday blocks first, then by start/end/id), one cell per
 * day the block runs. Callers pass one position's blocks and that position's
 * per-cell counts.
 */
export function buildCoverageRows(
  blocks: readonly ShiftBlock[],
  counts: readonly CellCount[],
): CoverageRow[] {
  const countByCell = new Map(counts.map((c) => [demandCellKey(c.blockId, c.day), c.count]));
  const closeIds = new Set(
    (["weekday", "weekend"] as const)
      .map((dayType) => deriveOpenClose(blocks.filter((b) => b.dayType === dayType)).closeId)
      .filter((id): id is string => id !== null),
  );

  const sorted = [...blocks].sort(
    (a, b) =>
      (a.dayType === b.dayType ? 0 : a.dayType === "weekday" ? -1 : 1) ||
      a.start - b.start ||
      a.end - b.end ||
      a.id.localeCompare(b.id),
  );

  return sorted.map((block) => {
    const target = block.desiredCapacity ?? null;
    const days = block.dayType === "weekend" ? WEEKEND_DAYS : WEEKDAY_DAYS;
    return {
      blockId: block.id,
      dayType: block.dayType,
      start: block.start,
      end: block.end,
      target,
      tier: latenessTier(block.end),
      isClose: closeIds.has(block.id),
      cells: days.map((day) => {
        const count = countByCell.get(demandCellKey(block.id, day)) ?? 0;
        return { day, count, target, status: coverageStatus(count, target) };
      }),
    };
  });
}

export interface CoverageSummary {
  /** Cells that have a target. */
  targetedCells: number;
  /** Targeted cells below their target. */
  shortCells: number;
  /** Total people missing across short cells. */
  missing: number;
}

export function summarizeCoverage(rows: readonly CoverageRow[]): CoverageSummary {
  const summary: CoverageSummary = { targetedCells: 0, shortCells: 0, missing: 0 };
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.target === null) continue;
      summary.targetedCells += 1;
      if (cell.count < cell.target) {
        summary.shortCells += 1;
        summary.missing += cell.target - cell.count;
      }
    }
  }
  return summary;
}

/** Seats a schedule run fills in one cell, per weekend rotation week. */
export interface AssignedCounts {
  a: number;
  b: number;
}

/**
 * The staffing a run gives one cell for grading against its target: the count
 * for weekday cells, the needier rotation week for weekend cells (each real
 * weekend day is worked by one cohort plus the every-weekend students, so the
 * target must hold in both weeks).
 */
export function assignedCellCount(dayType: DayType, counts: AssignedCounts | undefined): number {
  if (!counts) return 0;
  return dayType === "weekend" ? Math.min(counts.a, counts.b) : counts.a;
}

/** summarizeCoverage against a run's assigned seats instead of selection supply. */
export function summarizeAssignedCoverage(
  rows: readonly CoverageRow[],
  assigned: ReadonlyMap<string, AssignedCounts>,
): CoverageSummary {
  const summary: CoverageSummary = { targetedCells: 0, shortCells: 0, missing: 0 };
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.target === null) continue;
      summary.targetedCells += 1;
      const count = assignedCellCount(
        row.dayType,
        assigned.get(demandCellKey(row.blockId, cell.day)),
      );
      if (count < cell.target) {
        summary.shortCells += 1;
        summary.missing += cell.target - count;
      }
    }
  }
  return summary;
}
