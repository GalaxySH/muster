/**
 * Selection-cell key helpers shared by the form UI and persistence. A cell is
 * the pair (blockId, day); the client tracks a Set of these keys.
 */
import { dayTypeOf, type Day, type SelectedShift, type ShiftBlock } from "@/lib/domain/types";
import { mergeRanges } from "@/lib/domain/intervals";
import type { TimeRange } from "@/lib/domain/time";

const SEP = "|";

export function selectionKey(blockId: string, day: Day): string {
  return `${blockId}${SEP}${day}`;
}

/**
 * Cells that are implicitly covered: a block whose time range falls entirely
 * within the *combined* span of the selected shifts on that day. Because
 * adjacent shifts merge (e.g. 2–5p + 5–10p ⇒ 2–10p), a straddling block like
 * 3:30–7p is covered too. These render as "already covered" hints — the student
 * needn't also pick them. Display-only; not part of the saved selection.
 */
export function computeCoveredKeys(
  selection: readonly SelectedShift[],
  blocks: readonly ShiftBlock[],
): Set<string> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const selectedByDay = new Map<Day, TimeRange[]>();
  const selectedKeys = new Set<string>();
  for (const s of selection) {
    const block = byId.get(s.blockId);
    if (!block) continue;
    selectedKeys.add(selectionKey(s.blockId, s.day));
    const list = selectedByDay.get(s.day) ?? [];
    list.push({ start: block.start, end: block.end });
    selectedByDay.set(s.day, list);
  }

  const covered = new Set<string>();
  for (const [day, intervals] of selectedByDay) {
    const dayType = dayTypeOf(day);
    const spans = mergeRanges(intervals);
    for (const candidate of blocks) {
      if (candidate.dayType !== dayType) continue;
      const key = selectionKey(candidate.id, day);
      if (selectedKeys.has(key)) continue; // explicitly selected, not merely covered
      if (spans.some((s) => s.start <= candidate.start && s.end >= candidate.end)) {
        covered.add(key);
      }
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
