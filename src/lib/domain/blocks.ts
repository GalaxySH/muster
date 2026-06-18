/**
 * Open/close derivation for shift blocks (PLAN.md §6.2).
 *
 * Open/close are NOT stored — they're derived per position per day-type:
 * the earliest-starting block of a day-type is the opening shift, the
 * latest-ending block is the closing shift. Callers pass a list already
 * filtered to a single position + day-type.
 */
import type { ShiftBlock } from "./types";

export interface OpenClose {
  openId: string | null;
  closeId: string | null;
}

/** Derive the opening and closing block ids from a day-type's block set. */
export function deriveOpenClose(blocks: readonly ShiftBlock[]): OpenClose {
  if (blocks.length === 0) {
    return { openId: null, closeId: null };
  }
  let open = blocks[0]!;
  let close = blocks[0]!;
  for (const b of blocks) {
    if (b.start < open.start) open = b;
    if (b.end > close.end) close = b;
  }
  return { openId: open.id, closeId: close.id };
}

export function isOpenBlock(blockId: string, blocks: readonly ShiftBlock[]): boolean {
  return deriveOpenClose(blocks).openId === blockId;
}

export function isCloseBlock(blockId: string, blocks: readonly ShiftBlock[]): boolean {
  return deriveOpenClose(blocks).closeId === blockId;
}
