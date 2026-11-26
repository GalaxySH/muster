/**
 * The cards on a student's page and how an admin has arranged them (the
 * board). Pure and client-safe: the page uses it to order what it renders, the
 * board to move cards and resize columns. The saved layout itself is in
 * `preferences-shape.ts`.
 *
 * A layout always names every card, including the ones a given student does
 * not render (no closes for someone who is not a Shift Lead), so a card keeps
 * its place for the students who do have it. Moves are made against what is
 * visible: "up" passes the visible card above, never a hidden one.
 */
import {
  COLUMN_SHARE_MAX,
  COLUMN_SHARE_MIN,
  normalizeShares,
  type StudentLayout,
} from "./preferences-shape";

export type Columns = StudentLayout["columns"];

/** Every card the page can render, with its default column. */
export const DEFAULT_STUDENT_LAYOUT: StudentLayout = {
  columns: [
    ["grid", "flags", "coverage"],
    ["course", "extracurriculars", "travel", "closes"],
    ["changes", "scheduler-notes", "student-notes", "details"],
  ],
  // The 1.55fr / 1fr / 1fr the page had before it could be arranged.
  widths: normalizeShares([1.55, 1, 1]),
};

const copyColumns = (c: Columns): Columns => [[...c[0]], [...c[1]], [...c[2]]];

/**
 * The saved layout made whole against the defaults: ids the defaults do not
 * know are dropped, and a card the saved layout does not name (one added since
 * it was saved) goes into its default column, after the nearest card that
 * precedes it there by default, else before the nearest that follows, else at
 * the end. Shares are clamped to the limits.
 */
export function completeLayout(
  saved: StudentLayout | null,
  defaults: StudentLayout = DEFAULT_STUDENT_LAYOUT,
): StudentLayout {
  if (!saved) return { columns: copyColumns(defaults.columns), widths: [...defaults.widths] };
  const known = new Set(defaults.columns.flat());
  const seen = new Set<string>();
  const columns = saved.columns.map((col) =>
    col.filter((id) => known.has(id) && !seen.has(id) && (seen.add(id), true)),
  ) as Columns;

  defaults.columns.forEach((defaultCol, c) => {
    defaultCol.forEach((id, i) => {
      if (seen.has(id)) return;
      const target = columns[c]!;
      const before = defaultCol
        .slice(0, i)
        .reverse()
        .find((n) => target.includes(n));
      const after = defaultCol.slice(i + 1).find((n) => target.includes(n));
      if (before !== undefined) target.splice(target.indexOf(before) + 1, 0, id);
      else if (after !== undefined) target.splice(target.indexOf(after), 0, id);
      else target.push(id);
      seen.add(id);
    });
  });
  return { columns, widths: normalizeShares(saved.widths) };
}

/** The columns as rendered: only the cards that render for this student, in layout order. */
export function visibleColumns(columns: Columns, present: Iterable<string>): Columns {
  const has = new Set(present);
  return columns.map((col) => col.filter((id) => has.has(id))) as Columns;
}

/** The three ordered columns of cards to render, from the saved layout (or none). */
export function arrangeCards(
  saved: StudentLayout | null,
  defaults: StudentLayout,
  present: Iterable<string>,
): Columns {
  return visibleColumns(completeLayout(saved, defaults).columns, present);
}

/** Where a card is among the visible ones, or null when it is not visible. */
export function locateCard(
  columns: Columns,
  present: Iterable<string>,
  id: string,
): { column: number; index: number } | null {
  const visible = visibleColumns(columns, present);
  for (let c = 0; c < 3; c++) {
    const index = visible[c]!.indexOf(id);
    if (index >= 0) return { column: c, index };
  }
  return null;
}

/**
 * Moves a card to `toColumn`, at `toIndex` among that column's visible cards
 * once the card itself is taken out (so 0 is the top, the count is the end).
 * Hidden cards keep their places relative to the ones around them.
 */
export function moveCard(
  columns: Columns,
  present: Iterable<string>,
  id: string,
  toColumn: number,
  toIndex: number,
): Columns {
  const has = new Set(present);
  const next = columns.map((col) => col.filter((n) => n !== id)) as Columns;
  const target = next[toColumn];
  if (!target) return columns;
  const visible = target.filter((n) => has.has(n));
  const index = Math.max(0, Math.min(toIndex, visible.length));
  if (index < visible.length) {
    target.splice(target.indexOf(visible[index]!), 0, id);
  } else if (visible.length > 0) {
    target.splice(target.indexOf(visible[visible.length - 1]!) + 1, 0, id);
  } else {
    target.push(id);
  }
  return next;
}

/** The moves a card's buttons make, or null where it cannot go that way. */
export function stepTarget(
  columns: Columns,
  present: Iterable<string>,
  id: string,
  step: "up" | "down" | "left" | "right",
): { column: number; index: number } | null {
  const at = locateCard(columns, present, id);
  if (!at) return null;
  const visible = visibleColumns(columns, present);
  switch (step) {
    case "up":
      return at.index > 0 ? { column: at.column, index: at.index - 1 } : null;
    case "down":
      return at.index < visible[at.column]!.length - 1
        ? { column: at.column, index: at.index + 1 }
        : null;
    case "left":
    case "right": {
      const column = at.column + (step === "left" ? -1 : 1);
      if (column < 0 || column > 2) return null;
      return { column, index: Math.min(at.index, visible[column]!.length) };
    }
  }
}

/**
 * Moves the line between column `separator` and the next one by `delta` (a
 * share of the row). Only those two change, and neither leaves the limits.
 */
export function resizeColumns(
  widths: StudentLayout["widths"],
  separator: 0 | 1,
  delta: number,
): StudentLayout["widths"] {
  const { min, max } = separatorRange(widths, separator);
  const pair = widths[separator] + widths[(separator + 1) as 1 | 2];
  const left = Math.min(max, Math.max(min, widths[separator] + delta));
  const next = [...widths] as StudentLayout["widths"];
  next[separator] = left;
  next[(separator + 1) as 1 | 2] = pair - left;
  return normalizeShares(next);
}

/** How far the column left of a separator can grow or shrink. */
export function separatorRange(
  widths: StudentLayout["widths"],
  separator: 0 | 1,
): { min: number; max: number } {
  const pair = widths[separator] + widths[(separator + 1) as 1 | 2];
  return {
    min: Math.max(COLUMN_SHARE_MIN, pair - COLUMN_SHARE_MAX),
    max: Math.min(COLUMN_SHARE_MAX, pair - COLUMN_SHARE_MIN),
  };
}
