/**
 * Selection-cell key helpers shared by the form UI and persistence. A cell is
 * the pair (blockId, day); the client tracks a Set of these keys.
 */
import { dayTypeOf, type Day, type SelectedShift, type ShiftBlock } from "@/lib/domain/types";

const SEP = "|";

export function selectionKey(blockId: string, day: Day): string {
  return `${blockId}${SEP}${day}`;
}

/**
 * Cells that are implicitly covered: a block whose time range falls entirely
 * within a longer *selected* shift on the same day (e.g. 10a–12:45p when
 * 10a–2p is selected). These render as "already covered" hints — the student
 * doesn't need to also pick them. Display-only; not part of the saved selection.
 */
export function computeCoveredKeys(
  selection: readonly SelectedShift[],
  blocks: readonly ShiftBlock[],
): Set<string> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const selectedByDay = new Map<Day, ShiftBlock[]>();
  for (const s of selection) {
    const block = byId.get(s.blockId);
    if (!block) continue;
    const list = selectedByDay.get(s.day) ?? [];
    list.push(block);
    selectedByDay.set(s.day, list);
  }

  const covered = new Set<string>();
  for (const [day, selectedBlocks] of selectedByDay) {
    const dayType = dayTypeOf(day);
    for (const candidate of blocks) {
      if (candidate.dayType !== dayType) continue;
      const isCovered = selectedBlocks.some(
        (sel) =>
          sel.start <= candidate.start &&
          sel.end >= candidate.end &&
          (sel.start < candidate.start || sel.end > candidate.end), // proper superset
      );
      if (isCovered) covered.add(selectionKey(candidate.id, day));
    }
  }
  return covered;
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
