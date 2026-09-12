/**
 * Selection carry-over for position changes (roadmap 3.3; PLAN.md §6).
 *
 * When a student with saved selections moves to another position (a PCPL
 * promotion, an alias switch, or a ghost resolution), each selection survives
 * only if the target position has a block with the same day-type and
 * identical start/end times: it is re-pointed to that block, keeping its day
 * and autoAssigned flag.
 *
 * A selection with no time-identical counterpart is NOT deleted. It stays
 * exactly where it is, pointing at the old position's block, which makes it an
 * orphan (domain/orphans.ts): dead to every calculation, but visible to the
 * admin as a read-only row they can clear. A student's answer is never thrown
 * away just because their position moved under it; only the admin decides a
 * pick is finished with. Those rows come back as `unmatched`, and the caller
 * leaves them alone.
 *
 * The rows the caller DOES remove come back as `consumed`: the originals of
 * everything re-pointed, plus the losers of a same-time collapse. A collapse
 * loser is genuinely redundant rather than orphaned, since the time slot it
 * covers carried over on another row, and preserving it would show the admin a
 * dead pick sitting next to a live pick at the very same hours.
 *
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
  /**
   * Original rows the carry-over used up: the source row behind every `kept`
   * entry, plus same-time collapse losers. Exactly the set the caller deletes.
   */
  consumed: S[];
  /**
   * Original rows with no time-identical counterpart, including stale rows
   * pointing outside the source set. The caller LEAVES THESE IN PLACE; they
   * become orphans on the old position's blocks (see the header).
   */
  unmatched: S[];
}

/** A block's time slot identity within a position's set. */
const timeKey = (block: ShiftBlock) => `${block.dayType}|${block.start}|${block.end}`;

/**
 * Carry a student's selections from `sourceBlocks` over to `targetBlocks`.
 * Every input row lands in exactly one of `consumed` or `unmatched`, and
 * `kept` holds the re-pointed copy of each consumed row that survived a
 * collapse. Two source blocks with identical times collapse onto one target
 * row per day (the selection table keys on block + day); the student-picked
 * row wins over an auto-assigned duplicate, otherwise the first one seen wins.
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

  const unmatched: S[] = [];
  // Collapse losers. They are consumed rather than unmatched: their time slot
  // did carry over, just on a different row.
  const superseded: S[] = [];
  // (target block id, day) -> the winning re-pointed row plus its original,
  // kept together so a deduped winner can still surrender its slot.
  const keptByKey = new Map<string, { row: S; original: S }>();

  for (const selection of selections) {
    const source = sourceById.get(selection.blockId);
    const target = source && targetByTime.get(timeKey(source));
    if (!target) {
      unmatched.push(selection);
      continue;
    }
    const carried = { ...selection, blockId: target.id };
    const key = `${target.id}|${selection.day}`;
    const existing = keptByKey.get(key);
    if (!existing) {
      keptByKey.set(key, { row: carried, original: selection });
    } else if (existing.row.autoAssigned && !carried.autoAssigned) {
      superseded.push(existing.original);
      keptByKey.set(key, { row: carried, original: selection });
    } else {
      superseded.push(selection);
    }
  }

  const winners = [...keptByKey.values()];
  return {
    kept: winners.map((entry) => entry.row),
    consumed: [...winners.map((entry) => entry.original), ...superseded],
    unmatched,
  };
}
