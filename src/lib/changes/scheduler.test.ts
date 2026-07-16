import { beforeEach, describe, expect, it, vi } from "vitest";

// scheduler.ts is `server-only` and pulls settings (db/env) + the digest
// sender. The due-check (digest-schedule.ts) is pure and stays real; the I/O
// seams are mocked so the tick's claim protocol is testable in isolation.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({
  getChangeDigestLastRun: vi.fn(),
  claimChangeDigestRun: vi.fn(),
}));
vi.mock("./digest", () => ({ runChangeDigest: vi.fn() }));

import { claimChangeDigestRun, getChangeDigestLastRun } from "@/lib/settings";
import { runChangeDigest } from "./digest";
import { digestTick } from "./scheduler";

const now = new Date("2026-07-15T12:30:00.000Z"); // 7:30 AM CDT: a run is owed
const lastRunYesterday = new Date("2026-07-14T12:00:05.000Z");
const lastRunToday = new Date("2026-07-15T12:00:05.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runChangeDigest).mockResolvedValue({
    sent: false,
    requestCount: 0,
    recipientCount: 0,
    reason: "no-requests",
  });
});

describe("digestTick", () => {
  it("does nothing when today's run already happened", async () => {
    vi.mocked(getChangeDigestLastRun).mockResolvedValue(lastRunToday);
    expect(await digestTick(now)).toBe("not-due");
    expect(claimChangeDigestRun).not.toHaveBeenCalled();
    expect(runChangeDigest).not.toHaveBeenCalled();
  });

  it("claims with the exact value it read, then runs", async () => {
    vi.mocked(getChangeDigestLastRun).mockResolvedValue(lastRunYesterday);
    vi.mocked(claimChangeDigestRun).mockResolvedValue(true);
    expect(await digestTick(now)).toBe("ran");
    expect(claimChangeDigestRun).toHaveBeenCalledWith(lastRunYesterday, now);
    expect(runChangeDigest).toHaveBeenCalledWith(now);
  });

  it("runs on the first-ever tick (no run recorded)", async () => {
    vi.mocked(getChangeDigestLastRun).mockResolvedValue(null);
    vi.mocked(claimChangeDigestRun).mockResolvedValue(true);
    expect(await digestTick(now)).toBe("ran");
    expect(claimChangeDigestRun).toHaveBeenCalledWith(null, now);
  });

  it("skips the run when another process wins the claim", async () => {
    vi.mocked(getChangeDigestLastRun).mockResolvedValue(lastRunYesterday);
    vi.mocked(claimChangeDigestRun).mockResolvedValue(false);
    expect(await digestTick(now)).toBe("lost-claim");
    expect(runChangeDigest).not.toHaveBeenCalled();
  });

  it("swallows failures so the interval survives to retry", async () => {
    vi.mocked(getChangeDigestLastRun).mockRejectedValue(new Error("db down"));
    expect(await digestTick(now)).toBe("error");
    expect(runChangeDigest).not.toHaveBeenCalled();
  });
});
