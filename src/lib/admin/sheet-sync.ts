/**
 * Orchestrates the managed Drive spreadsheets behind a rate limit: build a
 * target's matrix and push it into its sheet. Two targets exist (PLAN.md §10,
 * §12, §18a): the running responses sheet and the SL closes backup sheet; each
 * carries its own Drive name, cached sheet id, and matrix builder.
 *
 * Rate limit (per product decision): the cooldown is split by trigger. The
 * best-effort resync after a student submit/claim uses a hard 10-minute
 * cooldown so a burst doesn't hammer the Sheets API; the manual admin
 * "Rebuild" button uses a short 30-second cooldown so a human can refresh on
 * demand. The caller passes which cooldown applies.
 */
import "server-only";
import {
  getSetting,
  setSetting,
  SETTING_RESPONSES_SHEET_ID,
  SETTING_RESPONSES_SHEET_SYNCED_AT,
  SETTING_CLOSES_SHEET_ID,
  SETTING_CLOSES_SHEET_SYNCED_AT,
} from "@/lib/settings";
import { upsertManagedSheet } from "@/lib/drive/relay";
import { loadCloseAdmin } from "@/lib/closes/data";
import { buildCloseClaimsMatrix } from "@/lib/closes/export";
import { loadExportData } from "./export-data";
import { buildExportMatrix } from "./export";

/** Automatic post-submit/claim resync: hard 10-minute cooldown. */
export const SHEET_AUTO_COOLDOWN_MS = 10 * 60 * 1000;
/** Manual admin "Rebuild" button: short 30-second cooldown. */
export const SHEET_MANUAL_COOLDOWN_MS = 30 * 1000;

export interface SheetTarget {
  /** Drive file name of the spreadsheet. */
  name: string;
  /** app_settings key caching the spreadsheet id. */
  idSettingKey: string;
  /** app_settings key holding the last successful sync instant. */
  syncedAtSettingKey: string;
  buildValues: () => Promise<string[][]>;
}

export const RESPONSES_SHEET: SheetTarget = {
  name: "Muster Responses",
  idSettingKey: SETTING_RESPONSES_SHEET_ID,
  syncedAtSettingKey: SETTING_RESPONSES_SHEET_SYNCED_AT,
  buildValues: async () => buildExportMatrix(await loadExportData()),
};

export const CLOSES_SHEET: SheetTarget = {
  name: "Muster SL Closes",
  idSettingKey: SETTING_CLOSES_SHEET_ID,
  syncedAtSettingKey: SETTING_CLOSES_SHEET_SYNCED_AT,
  buildValues: async () => buildCloseClaimsMatrix((await loadCloseAdmin()).slots),
};

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

export async function getLastSheetSync(target: SheetTarget): Promise<Date | null> {
  const v = await getSetting(target.syncedAtSettingKey);
  return v ? new Date(v) : null;
}

/** The Drive URL of a target's sheet, if one has been created. */
export async function getSheetUrl(target: SheetTarget): Promise<string | null> {
  const id = await getSetting(target.idSettingKey);
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

/**
 * Rebuild a target's sheet unless within the given cooldown. Throws on
 * Drive/Sheets errors (callers decide whether to surface or swallow). `now` is
 * injectable for tests; `cooldownMs` selects the per-trigger rate limit.
 */
export async function syncSheet(
  target: SheetTarget,
  { cooldownMs, now = new Date() }: { cooldownMs: number; now?: Date },
): Promise<SheetSyncResult> {
  const last = await getLastSheetSync(target);
  const remaining = cooldownRemainingMs(last, now, cooldownMs);
  if (remaining > 0) {
    return {
      synced: false,
      cooldown: true,
      lastSyncedAt: last,
      nextEligibleAt: new Date(now.getTime() + remaining),
    };
  }

  const values = await target.buildValues();
  const { url } = await upsertManagedSheet(target, values);
  await setSetting(target.syncedAtSettingKey, now.toISOString());
  return { synced: true, url, lastSyncedAt: now, nextEligibleAt: null };
}

/** Best-effort resync (rate-limited) for the student submit/claim path; never throws. */
export async function trySyncSheet(target: SheetTarget): Promise<void> {
  try {
    await syncSheet(target, { cooldownMs: SHEET_AUTO_COOLDOWN_MS });
  } catch (e) {
    console.error(`${target.name} sheet sync failed (non-fatal):`, e);
  }
}
