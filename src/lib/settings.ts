/**
 * Tiny key/value accessor over the `app_settings` table (PLAN.md §13): runtime
 * state (the Drive proofs-folder id, the running responses-sheet id, the last
 * sheet-sync timestamp) and admin-set app config (default-group auto-assign,
 * the travel cutoff).
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { defaultTravelCutoff } from "@/lib/domain/travel";

export const SETTING_PROOFS_FOLDER_ID = "proofs_folder_id";
export const SETTING_RESPONSES_SHEET_ID = "responses_sheet_id";
export const SETTING_RESPONSES_SHEET_SYNCED_AT = "responses_sheet_synced_at";
/** "1"/"0": whether ungrouped students get swept into the default group (PLAN §13). Absent ⇒ off. */
export const SETTING_DEFAULT_GROUP_AUTO_ASSIGN = "default_group_auto_assign";
/** ISO instant overriding the default 9/1 travel cutoff (PLAN §8). Absent ⇒ default. */
export const SETTING_TRAVEL_CUTOFF = "travel_cutoff";

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb()
    .insert(appSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

export async function deleteSetting(key: string): Promise<void> {
  await getDb().delete(appSettings).where(eq(appSettings.key, key));
}

/**
 * The effective travel-excusal cutoff (PLAN §8): the admin-configured instant
 * if one is stored, else the 9/1 default for the current cycle.
 */
export async function getTravelCutoff(
  now: Date = new Date(),
): Promise<{ cutoff: Date; isCustom: boolean }> {
  const raw = await getSetting(SETTING_TRAVEL_CUTOFF);
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return { cutoff: d, isCustom: true };
  }
  return { cutoff: defaultTravelCutoff(now), isCustom: false };
}
