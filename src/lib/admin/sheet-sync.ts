/**
 * Orchestrates the running responses spreadsheet (PLAN.md §10, §12): build the
 * export matrix and push it into the Drive sheet, behind a hard rate limit.
 *
 * Rate limit (per product decision): no rebuild may run within 10 minutes of
 * the last one — applies to BOTH the manual admin button and the best-effort
 * resync after a student submits. Keeps Drive writes cheap and avoids hammering
 * the Sheets API when many students submit in a burst.
 */
import "server-only";
import {
  getSetting,
  setSetting,
  SETTING_RESPONSES_SHEET_ID,
  SETTING_RESPONSES_SHEET_SYNCED_AT,
} from "@/lib/settings";
import { upsertResponsesSheet } from "@/lib/drive/relay";
import { loadExportData } from "./export-data";
import { buildExportMatrix, toCsv } from "./export";

export const RESPONSES_SHEET_COOLDOWN_MS = 10 * 60 * 1000;

export interface SheetSyncResult {
  synced: boolean;
  /** true when skipped because the 10-minute cooldown hasn't elapsed. */
  cooldown?: boolean;
  url?: string;
  lastSyncedAt: Date | null;
  nextEligibleAt: Date | null;
}

export async function getLastSheetSync(): Promise<Date | null> {
  const v = await getSetting(SETTING_RESPONSES_SHEET_SYNCED_AT);
  return v ? new Date(v) : null;
}

/** The Drive URL of the running sheet, if one has been created. */
export async function getResponsesSheetUrl(): Promise<string | null> {
  const id = await getSetting(SETTING_RESPONSES_SHEET_ID);
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

/**
 * Rebuild the sheet unless within the cooldown. Throws on Drive/Sheets errors
 * (callers decide whether to surface or swallow). `now` is injectable for tests.
 */
export async function syncResponsesSheet(now: Date = new Date()): Promise<SheetSyncResult> {
  const last = await getLastSheetSync();
  if (last && now.getTime() - last.getTime() < RESPONSES_SHEET_COOLDOWN_MS) {
    return {
      synced: false,
      cooldown: true,
      lastSyncedAt: last,
      nextEligibleAt: new Date(last.getTime() + RESPONSES_SHEET_COOLDOWN_MS),
    };
  }

  const csv = toCsv(buildExportMatrix(await loadExportData()));
  const { url } = await upsertResponsesSheet(csv);
  await setSetting(SETTING_RESPONSES_SHEET_SYNCED_AT, now.toISOString());
  return { synced: true, url, lastSyncedAt: now, nextEligibleAt: null };
}

/** Best-effort resync (rate-limited) for the student submit path — never throws. */
export async function trySyncResponsesSheet(): Promise<void> {
  try {
    await syncResponsesSheet();
  } catch (e) {
    console.error("Responses sheet sync failed (non-fatal):", e);
  }
}
