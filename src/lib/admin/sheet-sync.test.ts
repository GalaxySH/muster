import { beforeEach, describe, expect, it, vi } from "vitest";

// sheet-sync.ts is a `server-only` module. The marker package throws on import
// outside an RSC bundle, and its transitive imports (settings → db, drive/relay
// → env) pull in DB/env that aren't available under the node test env. We only
// exercise the pure `cooldownRemainingMs` + the cooldown consts, so stub the
// server-only marker and the transitive server modules to no-ops.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  SETTING_RESPONSES_SHEET_ID: "responses_sheet_id",
  SETTING_RESPONSES_SHEET_SYNCED_AT: "responses_sheet_synced_at",
  SETTING_CLOSES_SHEET_ID: "closes_sheet_id",
  SETTING_CLOSES_SHEET_SYNCED_AT: "closes_sheet_synced_at",
  SETTING_SCHEDULE_SHEET_ID: "schedule_sheet_id",
  SETTING_SCHEDULE_SHEET_SYNCED_AT: "schedule_sheet_synced_at",
}));
vi.mock("@/lib/drive/relay", () => ({ upsertManagedSheet: vi.fn() }));
vi.mock("@/lib/closes/data", () => ({ loadCloseAdmin: vi.fn() }));
vi.mock("@/lib/schedule/data", () => ({ loadCurrentSchedule: vi.fn() }));
vi.mock("@/lib/schedule/export", () => ({ buildScheduleMatrix: vi.fn() }));
vi.mock("./export-data", () => ({ loadExportData: vi.fn() }));
vi.mock("./export", () => ({ buildExportMatrix: vi.fn() }));

import { getSetting, setSetting } from "@/lib/settings";
import { upsertManagedSheet } from "@/lib/drive/relay";
import { loadCloseAdmin } from "@/lib/closes/data";
import { loadCurrentSchedule } from "@/lib/schedule/data";
import { workingTermId } from "@/lib/terms/working";
import { loadExportData } from "./export-data";
import { buildExportMatrix } from "./export";
import {
  CLOSES_SHEET,
  cooldownRemainingMs,
  RESPONSES_SHEET,
  SCHEDULE_SHEET,
  SHEET_AUTO_COOLDOWN_MS,
  SHEET_MANUAL_COOLDOWN_MS,
  syncSheet,
} from "./sheet-sync";

describe("cooldownRemainingMs", () => {
  const cooldown = 10 * 60 * 1000; // 10 minutes
  const now = new Date("2026-06-21T12:00:00.000Z");

  it("is eligible (0) when there is no prior sync", () => {
    expect(cooldownRemainingMs(null, now, cooldown)).toBe(0);
  });

  it("is eligible (0) once the full cooldown has elapsed", () => {
    const last = new Date(now.getTime() - cooldown);
    expect(cooldownRemainingMs(last, now, cooldown)).toBe(0);
  });

  it("is eligible (0) well after the cooldown has elapsed", () => {
    const last = new Date(now.getTime() - cooldown - 60_000);
    expect(cooldownRemainingMs(last, now, cooldown)).toBe(0);
  });

  it("returns the remaining ms while still within the window", () => {
    const last = new Date(now.getTime() - 4 * 60 * 1000); // synced 4 min ago
    expect(cooldownRemainingMs(last, now, cooldown)).toBe(6 * 60 * 1000); // 6 min left
  });

  it("returns the full cooldown when last sync is exactly now", () => {
    expect(cooldownRemainingMs(now, now, cooldown)).toBe(cooldown);
  });

  it("the manual cooldown is far shorter than the auto cooldown", () => {
    expect(SHEET_MANUAL_COOLDOWN_MS).toBeLessThan(SHEET_AUTO_COOLDOWN_MS);
    expect(SHEET_AUTO_COOLDOWN_MS).toBe(10 * 60 * 1000);
    expect(SHEET_MANUAL_COOLDOWN_MS).toBe(30 * 1000);
  });
});

describe("syncSheet", () => {
  const now = new Date("2026-06-21T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    // Were anything here to look the term up, it would get "B": a semester
    // started after the caller resolved "A".
    vi.mocked(workingTermId).mockImplementation(async () => "B");
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(upsertManagedSheet).mockResolvedValue({ spreadsheetId: "s1", url: "https://sheet" });
    vi.mocked(loadExportData).mockResolvedValue([]);
    vi.mocked(buildExportMatrix).mockReturnValue([["header"]]);
    vi.mocked(loadCloseAdmin).mockResolvedValue({ slots: [], leads: [] } as never);
    vi.mocked(loadCurrentSchedule).mockResolvedValue(null);
  });

  it("reads the stamp, builds the rows and writes the sheet in the caller's term only", async () => {
    const res = await syncSheet(RESPONSES_SHEET, "A", { cooldownMs: 0, now });

    expect(res.synced).toBe(true);
    expect(workingTermId).not.toHaveBeenCalled();
    expect(getSetting).toHaveBeenCalledWith("responses_sheet_synced_at:A");
    expect(loadExportData).toHaveBeenCalledWith("A");
    expect(upsertManagedSheet).toHaveBeenCalledWith(
      expect.objectContaining({ idSettingKey: "responses_sheet_id", termId: "A" }),
      [["header"]],
    );
    expect(setSetting).toHaveBeenCalledWith("responses_sheet_synced_at:A", now.toISOString());
  });

  it("hands the caller's term to the closes and schedule builders too", async () => {
    await syncSheet(CLOSES_SHEET, "A", { cooldownMs: 0, now });
    await syncSheet(SCHEDULE_SHEET, "A", { cooldownMs: 0, now });

    expect(loadCloseAdmin).toHaveBeenCalledWith("A");
    expect(loadCurrentSchedule).toHaveBeenCalledWith("A");
    expect(workingTermId).not.toHaveBeenCalled();
  });
});
