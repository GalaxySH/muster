/**
 * An admin's own console preferences: the colour theme and how the cards on a
 * student's page are arranged. Pure and client-safe, so the board can normalize
 * a layout as it is dragged and the server can parse what it stored with the
 * same rules. Storage is in `preferences.ts`.
 */
import { z } from "zod";

export type AdminTheme = "light" | "dark";

/** The student page's three columns: card ids per column in order, and each column's share of the width. */
export type StudentLayout = {
  columns: [string[], string[], string[]];
  widths: [number, number, number];
};

export type AdminPrefs = {
  /** Null follows the device. */
  theme: AdminTheme | null;
  /** Null is the default arrangement. */
  studentLayout: StudentLayout | null;
  /** The foldable cards (FOLDABLE_CARDS) the admin closed; the rest are open. */
  foldedCards: FoldableCard[];
};

/** The student page cards whose open or closed state is remembered. */
export const FOLDABLE_CARDS = ["coverage", "details"] as const;
export type FoldableCard = (typeof FOLDABLE_CARDS)[number];

export const EMPTY_PREFS: AdminPrefs = { theme: null, studentLayout: null, foldedCards: [] };

/** A column never gets narrower or wider than this share of the row. */
export const COLUMN_SHARE_MIN = 0.2;
export const COLUMN_SHARE_MAX = 0.6;

const cardId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const column = z.array(cardId).max(40);

export const studentLayoutSchema = z.object({
  columns: z.tuple([column, column, column]),
  widths: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
});

const prefsSchema = z.object({
  theme: z.enum(["light", "dark"]).nullable().catch(null).default(null),
  studentLayout: studentLayoutSchema.nullable().catch(null).default(null),
  foldedCards: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((ids) => FOLDABLE_CARDS.filter((id) => ids.includes(id))),
});

/** What is stored, read leniently: anything unreadable falls back to the default. */
export function parseAdminPrefs(raw: string | null): AdminPrefs {
  if (!raw) return EMPTY_PREFS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return EMPTY_PREFS;
  }
  const parsed = prefsSchema.safeParse(json);
  if (!parsed.success) return EMPTY_PREFS;
  const { theme, studentLayout, foldedCards } = parsed.data;
  return {
    theme,
    studentLayout: studentLayout ? normalizeStudentLayout(studentLayout) : null,
    foldedCards,
  };
}

/**
 * Column shares clamped to the limits and summing to 1, and each card in one
 * column only (its first). Clamping and rescaling alternate until both hold.
 */
export function normalizeStudentLayout(layout: StudentLayout): StudentLayout {
  const seen = new Set<string>();
  const columns = layout.columns.map((col) =>
    col.filter((id) => (seen.has(id) ? false : (seen.add(id), true))),
  ) as StudentLayout["columns"];
  return { columns, widths: normalizeShares(layout.widths) };
}

export function normalizeShares(widths: readonly number[]): [number, number, number] {
  let w = widths.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  for (let i = 0; i < 10; i++) {
    const sum = w.reduce((a, b) => a + b, 0);
    w = w.map((x) => Math.min(COLUMN_SHARE_MAX, Math.max(COLUMN_SHARE_MIN, x / sum)));
    if (Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-6) break;
  }
  return w.map((x) => Math.round(x * 1000) / 1000) as [number, number, number];
}
