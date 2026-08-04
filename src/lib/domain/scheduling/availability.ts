/**
 * Synthetic availability for students the generator schedules without a
 * response (docs/schedule-generation-plan.md §3).
 *
 * A non-responder has no selections at all. When an admin opts into scheduling
 * them, the generator treats them as available for every cell their position
 * runs, so they fill whatever capacity the responders left. Everything
 * downstream (the weekend seed, the minimum day span, the hour floor, and the
 * per-cell capacity targets) then applies to them unchanged.
 */
import { WEEKDAY_DAYS, WEEKEND_DAYS, type SelectedShift, type ShiftBlock } from "../types";

/**
 * Every (block x day) cell the given position runs: each of its blocks on
 * every day of that block's day-type. Blocks of other positions are ignored.
 */
export function fullAvailability(
  positionId: string,
  blocks: readonly ShiftBlock[],
): SelectedShift[] {
  const cells: SelectedShift[] = [];
  for (const block of blocks) {
    if (block.positionId !== positionId) continue;
    const days = block.dayType === "weekend" ? WEEKEND_DAYS : WEEKDAY_DAYS;
    for (const day of days) cells.push({ blockId: block.id, day });
  }
  return cells;
}
