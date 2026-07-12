/**
 * Selection carry-over for position changes (roadmap 3.3; PLAN.md §6).
 *
 * When a student with saved selections moves to another position (a PCPL
 * promotion, an alias switch, or a ghost resolution), each selection survives
 * only if the target position has a block with the same day-type and
 * identical start/end times: it is re-pointed to that block, keeping its day
 * and autoAssigned flag. Selections with no time-identical counterpart are
 * dropped, as are stale rows referencing a block outside the source set.
 * Pure: the caller owns the row updates/deletes and the re-validation run.
 */
import type { Day, ShiftBlock } from "./types";

/** The minimal shape of a stored selection row; extra fields pass through. */
export interface CarryOverRow {
  blockId: string;
  day: Day;
  autoAssigned: boolean;
}

export interface CarryOverResult<S extends CarryOverRow> {
  /** Surviving selections, re-pointed to the matching target block's id. */
  kept: S[];
  /** The original rows that did not survive (unmatched, stale, or deduped). */
  dropped: S[];
}

/** A block's time slot identity within a position's set. */
const timeKey = (block: ShiftBlock) => `${block.dayType}|${block.start}|${block.end}`;

/**
 * Carry a student's selections from `sourceBlocks` over to `targetBlocks`.
 * Every input row lands in exactly one of `kept` or `dropped`. Two source
 * blocks with identical times collapse onto one target row per day (the
 * selection table keys on block + day); the student-picked row wins over an
 * auto-assigned duplicate, otherwise the first one seen wins.
 */
export function carryOverSelections<S extends CarryOverRow>(
  selections: readonly S[],
  sourceBlocks: readonly ShiftBlock[],
  targetBlocks: readonly ShiftBlock[],
): CarryOverResult<S> {
  const sourceById = new Map(sourceBlocks.map((b) => [b.id, b]));
  // The first target block wins if the target set itself duplicates a time slot.
  const targetByTime = new Map<string, ShiftBlock>();
  for (const b of targetBlocks) {
    if (!targetByTime.has(timeKey(b))) targetByTime.set(timeKey(b), b);
  }

  const dropped: S[] = [];
  // (target block id, day) -> the winning re-pointed row plus its original,
  // kept together so a deduped winner can still surrender its slot.
  const keptByKey = new Map<string, { row: S; original: S }>();

  for (const selection of selections) {
    const source = sourceById.get(selection.blockId);
    const target = source && targetByTime.get(timeKey(source));
    if (!target) {
      dropped.push(selection);
      continue;
    }
    const carried = { ...selection, blockId: target.id };
    const key = `${target.id}|${selection.day}`;
    const existing = keptByKey.get(key);
    if (!existing) {
      keptByKey.set(key, { row: carried, original: selection });
    } else if (existing.row.autoAssigned && !carried.autoAssigned) {
      dropped.push(existing.original);
      keptByKey.set(key, { row: carried, original: selection });
    } else {
      dropped.push(selection);
    }
  }

  return { kept: [...keptByKey.values()].map((entry) => entry.row), dropped };
}
