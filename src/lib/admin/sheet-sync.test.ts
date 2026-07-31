import { describe, expect, it, vi } from "vitest";

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

import {
  cooldownRemainingMs,
  SHEET_AUTO_COOLDOWN_MS,
  SHEET_MANUAL_COOLDOWN_MS,
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
