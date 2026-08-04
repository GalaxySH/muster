/**
 * Orphaned selection cells (PLAN.md §6.2a).
 *
 * A selection row is *orphaned* when the block it points at is no longer part
 * of the student's live block set: the admin retired the block (it had picks,
 * so it could not simply be deleted), or a position change left the row
 * pointing somewhere else. Orphaned cells are dead data. They never count
 * toward capacity, never validate, never render in a student's grid, and are
 * never scheduled. The admin sees them, and only the admin can clear them.
 *
 * Splitting is pure so every calculation can consume `known` and every surface
 * that reports the problem can consume `orphaned`, with one shared rule.
 */
import type { SelectedShift, ShiftBlock } from "./types";

export interface SelectionPartition<T extends SelectedShift> {
  /** Cells whose block is in the live set: everything calculations may use. */
  known: T[];
  /** Cells whose block is missing from the live set. */
  orphaned: T[];
}

/**
 * Split a selection into the cells the given blocks can resolve and the cells
 * they cannot. Order is preserved within each side.
 */
export function partitionSelection<T extends SelectedShift>(
  selection: readonly T[],
  blocks: readonly ShiftBlock[],
): SelectionPartition<T> {
  const live = new Set(blocks.map((b) => b.id));
  const known: T[] = [];
  const orphaned: T[] = [];
  for (const cell of selection) {
    (live.has(cell.blockId) ? known : orphaned).push(cell);
  }
  return { known, orphaned };
}

/** Just the usable half, for the many call sites that only feed calculations. */
export function knownSelection<T extends SelectedShift>(
  selection: readonly T[],
  blocks: readonly ShiftBlock[],
): T[] {
  return partitionSelection(selection, blocks).known;
}
