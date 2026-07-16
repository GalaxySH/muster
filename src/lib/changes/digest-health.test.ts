import { describe, expect, it } from "vitest";
import {
  DIGEST_STALE_HOURS,
  DIGEST_STARTUP_GRACE_MS,
  digestRunHealth,
} from "./digest-health";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date("2026-07-15T13:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR_MS);
const longUp = DIGEST_STARTUP_GRACE_MS + 60_000;

describe("digestRunHealth", () => {
  it("reports disabled when the scheduler is off, whatever the stamp says", () => {
    expect(
      digestRunHealth({ schedulerEnabled: false, lastRunAt: hoursAgo(1), uptimeMs: longUp, now }),
    ).toBe("disabled");
    expect(
      digestRunHealth({ schedulerEnabled: false, lastRunAt: null, uptimeMs: 0, now }),
    ).toBe("disabled");
  });

  it("treats a missing first run as starting while inside the boot grace", () => {
    expect(
      digestRunHealth({ schedulerEnabled: true, lastRunAt: null, uptimeMs: 60_000, now }),
    ).toBe("starting");
  });

  it("treats a missing first run as never-ran once the grace has passed", () => {
    expect(
      digestRunHealth({ schedulerEnabled: true, lastRunAt: null, uptimeMs: longUp, now }),
    ).toBe("never-ran");
  });

  it("is ok while the last run is within the stale window", () => {
    expect(
      digestRunHealth({ schedulerEnabled: true, lastRunAt: hoursAgo(2), uptimeMs: longUp, now }),
    ).toBe("ok");
    expect(
      digestRunHealth({
        schedulerEnabled: true,
        lastRunAt: hoursAgo(DIGEST_STALE_HOURS),
        uptimeMs: longUp,
        now,
      }),
    ).toBe("ok");
  });

  it("goes stale once the last run ages past the window", () => {
    expect(
      digestRunHealth({
        schedulerEnabled: true,
        lastRunAt: hoursAgo(DIGEST_STALE_HOURS + 1),
        uptimeMs: longUp,
        now,
      }),
    ).toBe("stale");
  });

  it("treats a clock-skewed future run as ok, not stale", () => {
    expect(
      digestRunHealth({ schedulerEnabled: true, lastRunAt: hoursAgo(-1), uptimeMs: longUp, now }),
    ).toBe("ok");
  });
});
