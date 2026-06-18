/**
 * Selection-cell key helpers shared by the form UI and persistence. A cell is
 * the pair (blockId, day); the client tracks a Set of these keys.
 */
import type { Day, SelectedShift } from "@/lib/domain/types";

const SEP = "|";

export function selectionKey(blockId: string, day: Day): string {
  return `${blockId}${SEP}${day}`;
}

export function selectionToKeys(selection: readonly SelectedShift[]): Set<string> {
  return new Set(selection.map((s) => selectionKey(s.blockId, s.day)));
}

export function keysToSelection(keys: Iterable<string>): SelectedShift[] {
  return [...keys].map((k) => {
    const sep = k.lastIndexOf(SEP);
    return { blockId: k.slice(0, sep), day: k.slice(sep + 1) as Day };
  });
}
