/**
 * Weekend auto-assignment (PLAN.md §5 #5, §8).
 *
 * When a non-exempt student submits without choosing any weekend shift, the
 * scheduler still needs a weekend cell to place them on the A/B rotation. We
 * pick one for them ("I randomly chose this shift for you") and raise a soft
 * flag. This is pure selection logic; the action wires persistence around it.
 */
import { WEEKEND_DAYS, dayTypeOf, type Position, type SelectedShift, type ShiftBlock } from "./types";

/** Every (weekend block × weekend day) cell a student could be auto-assigned. */
export function weekendCandidates(blocks: readonly ShiftBlock[]): SelectedShift[] {
  const cells: SelectedShift[] = [];
  for (const block of blocks) {
    if (block.dayType !== "weekend") continue;
    for (const day of WEEKEND_DAYS) {
      cells.push({ blockId: block.id, day });
    }
  }
  return cells;
}

/** Does this submission still owe a weekend shift? (Barista is exempt.) */
export function needsWeekendAutoAssign(
  selection: readonly SelectedShift[],
  position: Position,
): boolean {
  if (position.weekendExempt) return false;
  return !selection.some((s) => dayTypeOf(s.day) === "weekend");
}

export interface ChooseWeekendOptions {
  /** A previously auto-assigned cell; reused when still valid (stable re-submits). */
  preferred?: SelectedShift | null;
  /** Index picker over the candidate list; defaults to uniform random. */
  pick?: (count: number) => number;
}

/**
 * Choose a weekend cell to auto-assign, or null when the position has no
 * weekend blocks. Prefers `preferred` when it is still a candidate so a student
 * who re-submits keeps the same machine-picked shift instead of it jumping
 * around.
 */
export function chooseWeekendAutoAssign(
  blocks: readonly ShiftBlock[],
  options: ChooseWeekendOptions = {},
): SelectedShift | null {
  const candidates = weekendCandidates(blocks);
  if (candidates.length === 0) return null;

  const { preferred } = options;
  if (preferred && candidates.some((c) => c.blockId === preferred.blockId && c.day === preferred.day)) {
    return preferred;
  }

  const pick = options.pick ?? ((count) => Math.floor(Math.random() * count));
  const index = Math.min(candidates.length - 1, Math.max(0, pick(candidates.length)));
  return candidates[index]!;
}
