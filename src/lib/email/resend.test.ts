import { beforeEach, describe, expect, it, vi } from "vitest";

// fetch is stubbed, so nothing here ever reaches Resend. The env carries a fake
// key so the code takes the real send path, and the test allowlist is the one
// address testing may ever use.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    RESEND_API_KEY: "re_test_not_a_real_key",
    EMAIL_FROM: "GDEC Scheduling <no-reply@re.hauge.rocks>",
    EMAIL_TEST_RECIPIENTS: "sfhauge@wisc.edu",
  },
}));
const getEmailSendingEnabled = vi.fn(async () => true);
vi.mock("@/lib/settings", () => ({ getEmailSendingEnabled: () => getEmailSendingEnabled() }));

const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

const { sendEmail } = await import("./resend");

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]![1] as unknown as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("sendEmail outside production", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    getEmailSendingEnabled.mockResolvedValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("blocks a student address and never calls Resend", async () => {
    expect(await sendEmail({ to: "student@wisc.edu", subject: "s", text: "t" })).toEqual({
      outcome: "blocked",
      cc: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a cc that isn't allowed and sends the rest", async () => {
    const outcome = await sendEmail({
      to: "sfhauge@wisc.edu",
      subject: "s",
      text: "t",
      cc: ["gdec_h-o@g-groups.wisc.edu"],
      replyTo: "gdec_h-o@g-groups.wisc.edu",
      from: "GDEC Scheduling <schedule@re.hauge.rocks>",
      idempotencyKey: "schedule-email-abc",
    });
    expect(outcome).toEqual({ outcome: "sent", cc: [] });
    const body = sentBody();
    expect(body.to).toEqual(["sfhauge@wisc.edu"]);
    expect(body.cc).toBeUndefined();
    expect(body.reply_to).toBe("gdec_h-o@g-groups.wisc.edu");
    expect(body.from).toBe("GDEC Scheduling <schedule@re.hauge.rocks>");
    const headers = (fetchMock.mock.calls[0]![1] as unknown as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers["Idempotency-Key"]).toBe("schedule-email-abc");
  });

  it("uses EMAIL_FROM when no sender is given", async () => {
    await sendEmail({ to: "sfhauge@wisc.edu", subject: "s", text: "t" });
    expect(sentBody().from).toBe("GDEC Scheduling <no-reply@re.hauge.rocks>");
  });

  it("sends nothing when the master switch is off", async () => {
    getEmailSendingEnabled.mockResolvedValue(false);
    expect((await sendEmail({ to: "sfhauge@wisc.edu", subject: "s", text: "t" })).outcome).toBe(
      "suppressed",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when Resend refuses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad from", { status: 422 }));
    await expect(sendEmail({ to: "sfhauge@wisc.edu", subject: "s", text: "t" })).rejects.toThrow(
      /422/,
    );
  });
});
