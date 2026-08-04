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
import { knownSelection } from "../orphans";
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

/**
 * What a fill-in offers: the answers they actually gave when they gave any,
 * full availability when they gave none. Never fabricate over a real answer.
 *
 * `blocks` must be the LIVE set. Picks on a removed shift are not answers
 * (PLAN §6.2a), so they are dropped before the "did they tell us anything?"
 * test — otherwise a stale draft that survives only as dead cells reads as an
 * answer and leaves the student schedulable nowhere, silently, which is the
 * exact case the fallback exists for.
 */
export function fillInSelection(
  positionId: string,
  blocks: readonly ShiftBlock[],
  drafted: readonly SelectedShift[] | undefined,
): SelectedShift[] {
  const live = knownSelection(drafted ?? [], blocks);
  return live.length > 0 ? live : fullAvailability(positionId, blocks);
}
