import { describe, expect, it } from "vitest";
import { DIGEST_STALE_HOURS, digestCronHealth } from "./digest-health";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date("2026-07-15T13:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR_MS);

describe("digestCronHealth", () => {
  it("reports no-secret when CRON_SECRET is unset, even with a recorded run", () => {
    expect(
      digestCronHealth({ secretConfigured: false, lastRunAt: hoursAgo(1), now }),
    ).toBe("no-secret");
    expect(digestCronHealth({ secretConfigured: false, lastRunAt: null, now })).toBe("no-secret");
  });

  it("reports never-ran when the secret is set but no run is recorded", () => {
    expect(digestCronHealth({ secretConfigured: true, lastRunAt: null, now })).toBe("never-ran");
  });

  it("is ok while the last run is within the stale window", () => {
    expect(digestCronHealth({ secretConfigured: true, lastRunAt: hoursAgo(2), now })).toBe("ok");
    expect(
      digestCronHealth({ secretConfigured: true, lastRunAt: hoursAgo(DIGEST_STALE_HOURS), now }),
    ).toBe("ok");
  });

  it("goes stale once the last run ages past the window", () => {
    expect(
      digestCronHealth({
        secretConfigured: true,
        lastRunAt: hoursAgo(DIGEST_STALE_HOURS + 1),
        now,
      }),
    ).toBe("stale");
  });

  it("treats a clock-skewed future run as ok, not stale", () => {
    expect(digestCronHealth({ secretConfigured: true, lastRunAt: hoursAgo(-1), now })).toBe("ok");
  });
});
