"use server";

/**
 * Saving the signed-in admin's own console preferences. An admin can only ever
 * write their own row: the email comes from the session, never the client.
 */
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getAdminPrefs, saveAdminPrefs } from "./preferences";
import { FOLDABLE_CARDS, normalizeStudentLayout, studentLayoutSchema } from "./preferences-shape";

export type PrefsResult = { ok: true } | { ok: false; error: string };

export async function saveAdminTheme(theme: "light" | "dark" | null): Promise<PrefsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = z.enum(["light", "dark"]).nullable().safeParse(theme);
  if (!parsed.success) return { ok: false, error: "Unknown theme." };
  await saveAdminPrefs(gate.email, { theme: parsed.data });
  return { ok: true };
}

/** Remember one of the foldable cards (FOLDABLE_CARDS) as closed or open. */
export async function saveCardFolded(cardId: string, folded: boolean): Promise<PrefsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const id = z.enum(FOLDABLE_CARDS).safeParse(cardId);
  if (!id.success) return { ok: false, error: "Unknown card." };
  const { foldedCards } = await getAdminPrefs(gate.email);
  const others = foldedCards.filter((c) => c !== id.data);
  await saveAdminPrefs(gate.email, { foldedCards: folded ? [...others, id.data] : others });
  return { ok: true };
}

/** `null` goes back to the default arrangement. */
export async function saveStudentLayout(layout: unknown): Promise<PrefsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (layout === null) {
    await saveAdminPrefs(gate.email, { studentLayout: null });
    return { ok: true };
  }
  const parsed = studentLayoutSchema.safeParse(layout);
  if (!parsed.success) return { ok: false, error: "That layout could not be saved." };
  await saveAdminPrefs(gate.email, { studentLayout: normalizeStudentLayout(parsed.data) });
  return { ok: true };
}
