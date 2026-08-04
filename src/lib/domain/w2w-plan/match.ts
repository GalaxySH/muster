/**
 * Resolves parsed W2W plan rows against the position map and Muster's shift
 * blocks (docs/w2w-shift-plan-roundtrip.md §4-§5).
 *
 * A row matches a block on (mapped position, day-type of the row's day, start,
 * end) exactly; the shift description is deliberately not part of the key (the
 * SL "Weekend Close" rows fill like any other seat). Unmapped and unmatched
 * rows are never dropped, only reported. Everything here is deterministic:
 * stable sort orders, no clocks, no randomness.
 */
import { WEEKDAY_DAYS, WEEKEND_DAYS, ALL_DAYS, dayTypeOf, type Day } from "../types";
import type {
  BlockCapacityLine,
  BlockSeatCell,
  MatchBlock,
  MatchedPlanRow,
  PlanMatchReport,
  UnmatchedShape,
  W2wPlanRow,
  W2wPositionMapEntry,
} from "./types";

/** Plain comparison, locale-free so report order never varies by host. */
function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const DAY_ORDER = new Map(ALL_DAYS.map((d, i) => [d, i]));

/** Key for one (blockId, day) seat cell. */
function cellKey(blockId: string, day: Day): string {
  return `${blockId}\u0000${day}`;
}

export function matchPlan(
  rows: W2wPlanRow[],
  map: W2wPositionMapEntry[],
  blocks: MatchBlock[],
): PlanMatchReport {
  const byId = new Map<string, W2wPositionMapEntry>();
  const byName = new Map<string, W2wPositionMapEntry>();
  for (const entry of map) {
    if (!byId.has(entry.w2wPositionId)) byId.set(entry.w2wPositionId, entry);
    if (!byName.has(entry.w2wPositionName)) byName.set(entry.w2wPositionName, entry);
  }

  const resolved: MatchedPlanRow[] = rows.map((row) => {
    const entry =
      (row.w2wPositionId === "" ? undefined : byId.get(row.w2wPositionId)) ??
      (row.w2wPositionName === "" ? undefined : byName.get(row.w2wPositionName));
    const musterPositionId = entry?.musterPositionId ?? null;
    let matchedBlockId: string | null = null;
    if (musterPositionId !== null) {
      const dayType = dayTypeOf(row.day);
      const block = blocks.find(
        (b) =>
          b.positionId === musterPositionId &&
          b.dayType === dayType &&
          b.startMinutes === row.startMinutes &&
          b.endMinutes === row.endMinutes,
      );
      matchedBlockId = block?.id ?? null;
    }
    return { ...row, musterPositionId, matchedBlockId };
  });

  // W2W positions the map does not know, once each.
  const unknownByKey = new Map<string, { w2wPositionId: string; w2wPositionName: string }>();
  for (const row of resolved) {
    if (row.musterPositionId !== null) continue;
    const key = `${row.w2wPositionId}\u0000${row.w2wPositionName}`;
    if (!unknownByKey.has(key)) {
      unknownByKey.set(key, {
        w2wPositionId: row.w2wPositionId,
        w2wPositionName: row.w2wPositionName,
      });
    }
  }
  const unknownPositions = [...unknownByKey.values()].sort(
    (a, b) => cmp(a.w2wPositionName, b.w2wPositionName) || cmp(a.w2wPositionId, b.w2wPositionId),
  );

  // Rows no block took, grouped by shape so the report stays readable.
  const shapeByKey = new Map<string, UnmatchedShape>();
  for (const row of resolved) {
    if (row.matchedBlockId !== null) continue;
    const dayType = dayTypeOf(row.day);
    const key = [
      row.w2wPositionName,
      row.musterPositionId ?? "",
      dayType,
      row.startMinutes,
      row.endMinutes,
      row.description,
    ].join("\u0000");
    const shape = shapeByKey.get(key);
    if (shape) {
      shape.rowCount += 1;
    } else {
      shapeByKey.set(key, {
        w2wPositionName: row.w2wPositionName,
        musterPositionId: row.musterPositionId,
        dayType,
        startMinutes: row.startMinutes,
        endMinutes: row.endMinutes,
        description: row.description,
        rowCount: 1,
      });
    }
  }
  const unmatched = [...shapeByKey.values()].sort(
    (a, b) =>
      cmp(a.w2wPositionName, b.w2wPositionName) ||
      cmp(a.startMinutes, b.startMinutes) ||
      cmp(a.endMinutes, b.endMinutes) ||
      cmp(a.dayType, b.dayType) ||
      cmp(a.description, b.description),
  );

  // Seats per (block, day): one plan row is one seat.
  const seatsByCell = new Map<string, number>();
  for (const row of resolved) {
    if (row.matchedBlockId === null) continue;
    const key = cellKey(row.matchedBlockId, row.day);
    seatsByCell.set(key, (seatsByCell.get(key) ?? 0) + 1);
  }
  const seatCells: BlockSeatCell[] = [...seatsByCell.entries()]
    .map(([key, seats]) => {
      const [blockId, day] = key.split("\u0000") as [string, Day];
      return { blockId, day, seats };
    })
    .sort((a, b) => cmp(a.blockId, b.blockId) || DAY_ORDER.get(a.day)! - DAY_ORDER.get(b.day)!);

  // Capacity lines for every block the plan touched. planSeats is the max
  // across the day-type's days, counting 0 for a day with no rows, so an
  // uneven plan is taken at its peak and flagged rather than averaged away.
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const touchedBlockIds = new Set<string>();
  for (const row of resolved) {
    if (row.matchedBlockId !== null) touchedBlockIds.add(row.matchedBlockId);
  }
  const capacity: BlockCapacityLine[] = [...touchedBlockIds]
    .map((blockId) => {
      const block = blockById.get(blockId)!;
      const days = block.dayType === "weekday" ? WEEKDAY_DAYS : WEEKEND_DAYS;
      const perDay = days.map((day) => seatsByCell.get(cellKey(blockId, day)) ?? 0);
      return {
        blockId,
        positionId: block.positionId,
        dayType: block.dayType,
        startMinutes: block.startMinutes,
        endMinutes: block.endMinutes,
        desiredCapacity: block.desiredCapacity,
        planSeats: Math.max(...perDay),
        unevenDays: perDay.some((count) => count !== perDay[0]),
      };
    })
    .sort(
      (a, b) =>
        cmp(a.positionId, b.positionId) ||
        cmp(a.dayType, b.dayType) ||
        cmp(a.startMinutes, b.startMinutes) ||
        cmp(a.endMinutes, b.endMinutes) ||
        cmp(a.blockId, b.blockId),
    );

  return {
    rows: resolved,
    matchedCount: resolved.filter((row) => row.matchedBlockId !== null).length,
    unmatched,
    unknownPositions,
    capacity,
    seatCells,
  };
}
