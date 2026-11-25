import { beforeEach, describe, expect, it, vi } from "vitest";

// digest.ts is `server-only` and pulls settings, the pending-request read, the
// email courier and the DB. Every seam is mocked so the stamping rule (rows are
// marked reported once a message actually went out to someone) is testable alone.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_URL: "https://muster.example.edu" } }));
vi.mock("@/lib/settings", () => ({
  getChangeDigestEnabled: vi.fn(),
  getChangeDigestRecipients: vi.fn(),
  getEmailSendingEnabled: vi.fn(),
  markChangeDigestRun: vi.fn(),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/terms/term-id", () => ({ getCurrentTermId: vi.fn() }));
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
import { getCurrentTermId } from "@/lib/terms/term-id";
import { loadPendingDigestRequests } from "./data";
import { buildChangeDigestEmail } from "./digest-email";
import { runChangeDigest } from "./digest";

const now = new Date("2026-07-15T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentTermId).mockResolvedValue("fall-2026");
  vi.mocked(loadPendingDigestRequests).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
  vi.mocked(getChangeDigestEnabled).mockResolvedValue(true);
  vi.mocked(getChangeDigestRecipients).mockResolvedValue(["a@wisc.edu", "b@wisc.edu"]);
  vi.mocked(getEmailSendingEnabled).mockResolvedValue(true);
  update.mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
});

describe("runChangeDigest", () => {
  it("reads the current term once and reports only its requests", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "sent", cc: [] });

    await runChangeDigest(now);

    expect(getCurrentTermId).toHaveBeenCalledTimes(1);
    expect(loadPendingDigestRequests).toHaveBeenCalledTimes(1);
    expect(loadPendingDigestRequests).toHaveBeenCalledWith("fall-2026");
  });

  // The scheduler catches the throw and logs it; the cron route answers 500.
  it("stamps and sends nothing when the current term cannot be read", async () => {
    vi.mocked(getCurrentTermId).mockRejectedValue(new Error("No current term"));

    await expect(runChangeDigest(now)).rejects.toThrow("No current term");

    expect(markChangeDigestRun).not.toHaveBeenCalled();
    expect(loadPendingDigestRequests).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

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

  // No send id, so a re-send of the same batch is the identical message, which
  // sendEmail drops as a repeat.
  it("sends each recipient the digest as built, with no send id", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "sent", cc: [] });

    await runChangeDigest(now);

    expect(vi.mocked(sendEmail).mock.calls.map(([m]) => m)).toEqual([
      { to: "a@wisc.edu", subject: "Digest", text: "body" },
      { to: "b@wisc.edu", subject: "Digest", text: "body" },
    ]);
  });

  // Not stamping would send everyone else the whole growing list every day for
  // as long as one address keeps failing. The failed recipient misses this one.
  it("stamps the requests when one recipient's send fails and another's goes out", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail)
      .mockResolvedValueOnce({ outcome: "sent", cc: [] })
      .mockRejectedValueOnce(new Error("timed out"));

    const res = await runChangeDigest(now);

    expect(vi.mocked(sendEmail).mock.calls.map(([m]) => m.to)).toEqual([
      "a@wisc.edu",
      "b@wisc.edu",
    ]);
    expect(res).toEqual({ sent: true, requestCount: 2, recipientCount: 2 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("still tries the later recipients after an earlier send fails, and stamps", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail)
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValueOnce({ outcome: "sent", cc: [] });

    const res = await runChangeDigest(now);

    expect(vi.mocked(sendEmail).mock.calls.map(([m]) => m.to)).toEqual([
      "a@wisc.edu",
      "b@wisc.edu",
    ]);
    expect(res).toEqual({ sent: true, requestCount: 2, recipientCount: 2 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("leaves the requests unstamped when one message was only logged and the other send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail)
      .mockResolvedValueOnce({ outcome: "logged", cc: [] })
      .mockRejectedValueOnce(new Error("timed out"));

    const res = await runChangeDigest(now);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      sent: false,
      requestCount: 2,
      recipientCount: 2,
      reason: "not-delivered",
    });
    expect(update).not.toHaveBeenCalled();
  });

  // sendEmail drops a repeat of an identical message, so a re-sent batch is one
  // email only if nothing in it changes from run to run.
  it("builds the same message for the same requests on different days", async () => {
    const actual = await vi.importActual<typeof import("./digest-email")>("./digest-email");
    vi.mocked(buildChangeDigestEmail)
      .mockImplementationOnce(actual.buildChangeDigestEmail)
      .mockImplementationOnce(actual.buildChangeDigestEmail);
    vi.mocked(loadPendingDigestRequests).mockResolvedValue([
      {
        id: "req-1",
        studentName: "Ada Lovelace",
        studentEmail: "ada@wisc.edu",
        day: "tue",
        shiftText: "2p to 5p",
        comment: "Lab moved.",
        permanent: false,
        status: "open",
        createdAt: new Date("2026-07-14T15:00:00.000Z"),
      },
    ]);
    vi.mocked(sendEmail).mockResolvedValue({ outcome: "logged", cc: [] });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
      await runChangeDigest(new Date("2026-07-15T12:00:00.000Z"));
      vi.setSystemTime(new Date("2026-07-16T12:00:07.123Z"));
      await runChangeDigest(new Date("2026-07-16T12:00:07.123Z"));
    } finally {
      vi.useRealTimers();
    }

    const sent = vi.mocked(sendEmail).mock.calls.map(([m]) => JSON.stringify(m));
    expect(sent).toHaveLength(4);
    expect(sent[2]).toBe(sent[0]);
    expect(sent[3]).toBe(sent[1]);
    expect(sent[0]).toContain("Lab moved.");
  });

  it("leaves the requests unstamped when every send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail).mockRejectedValue(new Error("timed out"));

    const res = await runChangeDigest(now);

    expect(res).toMatchObject({ sent: false, reason: "not-delivered" });
    expect(update).not.toHaveBeenCalled();
  });
});
