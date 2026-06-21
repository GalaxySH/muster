/**
 * Orchestrates the running responses spreadsheet (PLAN.md §10, §12): build the
 * export matrix and push it into the Drive sheet, behind a rate limit.
 *
 * Rate limit (per product decision): the cooldown is split by trigger. The
 * best-effort resync after a student submits uses a hard 10-minute cooldown so a
 * burst of submissions doesn't hammer the Sheets API; the manual admin "Rebuild"
 * button uses a short 30-second cooldown so a human can refresh on demand. The
 * caller passes which cooldown applies.
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
import { buildExportMatrix } from "./export";

/** Automatic post-submit resync: hard 10-minute cooldown. */
export const RESPONSES_SHEET_AUTO_COOLDOWN_MS = 10 * 60 * 1000;
/** Manual admin "Rebuild" button: short 30-second cooldown. */
export const RESPONSES_SHEET_MANUAL_COOLDOWN_MS = 30 * 1000;

export interface SheetSyncResult {
  synced: boolean;
  /** true when skipped because the cooldown hasn't elapsed. */
  cooldown?: boolean;
  url?: string;
  lastSyncedAt: Date | null;
  nextEligibleAt: Date | null;
}

/**
 * Pure cooldown math: ms remaining until a sync is eligible again, given the
 * last sync time, the current time, and the applicable cooldown. Returns 0 when
 * eligible (never synced, or the cooldown has fully elapsed).
 */
export function cooldownRemainingMs(last: Date | null, now: Date, cooldownMs: number): number {
  if (!last) return 0;
  const elapsed = now.getTime() - last.getTime();
  return Math.max(0, cooldownMs - elapsed);
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
 * Rebuild the sheet unless within the given cooldown. Throws on Drive/Sheets
 * errors (callers decide whether to surface or swallow). `now` is injectable for
 * tests; `cooldownMs` selects the per-trigger rate limit.
 */
export async function syncResponsesSheet({
  cooldownMs,
  now = new Date(),
}: {
  cooldownMs: number;
  now?: Date;
}): Promise<SheetSyncResult> {
  const last = await getLastSheetSync();
  const remaining = cooldownRemainingMs(last, now, cooldownMs);
  if (remaining > 0) {
    return {
      synced: false,
      cooldown: true,
      lastSyncedAt: last,
      nextEligibleAt: new Date(now.getTime() + remaining),
    };
  }

  const values = buildExportMatrix(await loadExportData());
  const { url } = await upsertResponsesSheet(values);
  await setSetting(SETTING_RESPONSES_SHEET_SYNCED_AT, now.toISOString());
  return { synced: true, url, lastSyncedAt: now, nextEligibleAt: null };
}

/** Best-effort resync (rate-limited) for the student submit path — never throws. */
export async function trySyncResponsesSheet(): Promise<void> {
  try {
    await syncResponsesSheet({ cooldownMs: RESPONSES_SHEET_AUTO_COOLDOWN_MS });
  } catch (e) {
    console.error("Responses sheet sync failed (non-fatal):", e);
  }
}
