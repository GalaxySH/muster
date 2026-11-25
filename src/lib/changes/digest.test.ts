import { beforeEach, describe, expect, it, vi } from "vitest";

// digest.ts is `server-only` and pulls settings, the pending-request read, the
// email courier and the DB. Every seam is mocked so the stamping rule (rows are
// marked reported only when a message actually went out) is testable alone.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_URL: "https://muster.example.edu" } }));
vi.mock("@/lib/settings", () => ({
  getChangeDigestEnabled: vi.fn(),
  getChangeDigestRecipients: vi.fn(),
  getEmailSendingEnabled: vi.fn(),
  markChangeDigestRun: vi.fn(),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("./data", () => ({ loadPendingDigestRequests: vi.fn() }));
vi.mock("./digest-email", () => ({
  buildChangeDigestEmail: vi.fn(() => ({ subject: "Digest", text: "body" })),
}));
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  getDb: () => ({ update }),
}));

import { sendEmail } from "@/lib/email/resend";
import {
  getChangeDigestEnabled,
  getChangeDigestRecipients,
  getEmailSendingEnabled,
  markChangeDigestRun,
} from "@/lib/settings";
import { loadPendingDigestRequests } from "./data";
import { runChangeDigest } from "./digest";

const now = new Date("2026-07-15T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPendingDigestRequests).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
  vi.mocked(getChangeDigestEnabled).mockResolvedValue(true);
  vi.mocked(getChangeDigestRecipients).mockResolvedValue(["a@wisc.edu", "b@wisc.edu"]);
  vi.mocked(getEmailSendingEnabled).mockResolvedValue(true);
  update.mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
});

describe("runChangeDigest", () => {
  it("stamps the requests once a digest is actually sent", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "sent", cc: [] });

    const res = await runChangeDigest(now);

    expect(res).toEqual({ sent: true, requestCount: 2, recipientCount: 2 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(markChangeDigestRun).toHaveBeenCalledWith(now);
  });

  it("leaves the requests unstamped when every message was only logged", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "logged", cc: [] });

    const res = await runChangeDigest(now);

    expect(res).toEqual({
      sent: false,
      requestCount: 2,
      recipientCount: 2,
      reason: "not-delivered",
    });
    expect(update).not.toHaveBeenCalled();
    // The run itself still happened, so the scheduler's liveness stamp stands.
    expect(markChangeDigestRun).toHaveBeenCalledWith(now);
  });

  it("leaves the requests unstamped when the test-recipient guard blocked every message", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "blocked", cc: [] });

    const res = await runChangeDigest(now);

    expect(res.sent).toBe(false);
    expect(res.reason).toBe("not-delivered");
    expect(update).not.toHaveBeenCalled();
  });

  it("stamps the requests when at least one recipient got the digest", async () => {
    vi.mocked(sendEmail)
      .mockResolvedValueOnce({ outcome: "blocked", cc: [] })
      .mockResolvedValueOnce({ outcome: "sent", cc: [] });

    const res = await runChangeDigest(now);

    expect(res.sent).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("sends each recipient the batch under its own repeatable key", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "sent", cc: [] });

    await runChangeDigest(now);
    const first = vi.mocked(sendEmail).mock.calls.map(([m]) => m.idempotencyKey);
    vi.mocked(sendEmail).mockClear();
    // The same requests again, in another order: the same keys.
    vi.mocked(loadPendingDigestRequests).mockResolvedValue([{ id: 2 }, { id: 1 }] as never);
    await runChangeDigest(now);
    const second = vi.mocked(sendEmail).mock.calls.map(([m]) => m.idempotencyKey);

    expect(first).toHaveLength(2);
    expect(first[0]).toMatch(/^change-digest-[0-9a-f]{32}-[0-9a-f]{16}$/);
    expect(first[0]).not.toBe(first[1]);
    expect(second).toEqual(first);
  });

  it("uses a new key once the batch has another request in it", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "sent", cc: [] });

    await runChangeDigest(now);
    vi.mocked(loadPendingDigestRequests).mockResolvedValue([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ] as never);
    await runChangeDigest(now);

    const keys = vi.mocked(sendEmail).mock.calls.map(([m]) => m.idempotencyKey);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("stamps the requests when one recipient's send fails and another's goes out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail)
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValueOnce({ outcome: "sent", cc: [] });

    const res = await runChangeDigest(now);

    expect(res.sent).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("leaves the requests unstamped when every send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail).mockRejectedValue(new Error("timed out"));

    const res = await runChangeDigest(now);

    expect(res).toMatchObject({ sent: false, reason: "not-delivered" });
    expect(update).not.toHaveBeenCalled();
  });
});
