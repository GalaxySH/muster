import { beforeEach, describe, expect, it, vi } from "vitest";

// fetch is stubbed, so nothing here ever reaches Resend. The env carries a fake
// key so the code takes the real send path, and the test allowlist is the one
// address testing may ever use, plus an undeliverable one to vary recipients.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    RESEND_API_KEY: "re_test_not_a_real_key",
    EMAIL_FROM: "GDEC Scheduling <no-reply@re.hauge.rocks>",
    EMAIL_TEST_RECIPIENTS: "sfhauge@wisc.edu, tester@example.invalid",
  },
}));
const getEmailSendingEnabled = vi.fn(async () => true);
vi.mock("@/lib/settings", () => ({ getEmailSendingEnabled: () => getEmailSendingEnabled() }));

const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

const { sendEmail } = await import("./resend");
type EmailMessage = Parameters<typeof sendEmail>[0];

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
    });
    expect(outcome).toEqual({ outcome: "sent", cc: [] });
    const body = sentBody();
    expect(body.to).toEqual(["sfhauge@wisc.edu"]);
    expect(body.cc).toBeUndefined();
    expect(body.reply_to).toBe("gdec_h-o@g-groups.wisc.edu");
    expect(body.from).toBe("GDEC Scheduling <schedule@re.hauge.rocks>");
  });

  describe("the Idempotency-Key", () => {
    const base: EmailMessage = {
      to: "sfhauge@wisc.edu",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
      cc: ["tester@example.invalid"],
      replyTo: "team@wisc.edu",
      from: "GDEC Scheduling <schedule@re.hauge.rocks>",
    };
    async function keyOf(message: EmailMessage): Promise<string> {
      fetchMock.mockClear();
      await sendEmail(message);
      const init = fetchMock.mock.calls[0]![1] as unknown as RequestInit;
      return (init.headers as Record<string, string>)["Idempotency-Key"]!;
    }

    it("is always sent, within Resend's length limit", async () => {
      const key = await keyOf({ to: "sfhauge@wisc.edu", subject: "s", text: "t" });
      expect(key).toMatch(/^email-[0-9a-f]{64}$/);
    });

    it("is the same for the same message", async () => {
      expect(await keyOf(base)).toBe(await keyOf({ ...base }));
    });

    it.each<[string, Partial<EmailMessage>]>([
      ["recipient", { to: "tester@example.invalid" }],
      ["subject", { subject: "s2" }],
      ["text", { text: "t2" }],
      ["html", { html: "<p>t2</p>" }],
      ["cc", { cc: [] }],
      ["reply-to", { replyTo: "other@wisc.edu" }],
      ["sender", { from: "GDEC Scheduling <no-reply@re.hauge.rocks>" }],
    ])("changes with the %s", async (_, change) => {
      expect(await keyOf({ ...base, ...change })).not.toBe(await keyOf(base));
    });

    it("changes when only the boundary between two fields moves", async () => {
      expect(await keyOf({ ...base, subject: "a", text: "bc" })).not.toBe(
        await keyOf({ ...base, subject: "ab", text: "c" }),
      );
      expect(await keyOf({ ...base, text: "t", html: "<p>" })).not.toBe(
        await keyOf({ ...base, text: "t<p>", html: undefined }),
      );
    });

    it("changes when only the split of the cc list moves", async () => {
      // The test guard drops any cc not on the allowlist, so the cc list only
      // reaches the key unguarded, as in production.
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      try {
        const prod = await import("./resend");
        const keyIn = async (cc: string[]) => {
          fetchMock.mockClear();
          await prod.sendEmail({ ...base, cc });
          const init = fetchMock.mock.calls[0]![1] as unknown as RequestInit;
          return (init.headers as Record<string, string>)["Idempotency-Key"]!;
        };
        expect(await keyIn(["x@y.edu", "z@w.edu"])).not.toBe(await keyIn(["x@y.edu,z@w.edu"]));
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    });

    it("changes with the send id, and repeats with the same one", async () => {
      const a = await keyOf({ ...base, sendId: "a" });
      expect(await keyOf({ ...base, sendId: "b" })).not.toBe(a);
      expect(await keyOf({ ...base, sendId: "a" })).toBe(a);
      expect(await keyOf(base)).not.toBe(a);
    });
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
