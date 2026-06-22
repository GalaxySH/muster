/**
 * Tiny key/value accessor over the `app_settings` table (PLAN.md §13). Used for
 * runtime-discovered state that isn't config: the Drive proofs-folder id, the
 * running responses-sheet id, and the last sheet-sync timestamp.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

export const SETTING_PROOFS_FOLDER_ID = "proofs_folder_id";
export const SETTING_RESPONSES_SHEET_ID = "responses_sheet_id";
export const SETTING_RESPONSES_SHEET_SYNCED_AT = "responses_sheet_synced_at";
/** "1"/"0": whether ungrouped students get swept into the default group (PLAN §13). Absent ⇒ off. */
export const SETTING_DEFAULT_GROUP_AUTO_ASSIGN = "default_group_auto_assign";

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
