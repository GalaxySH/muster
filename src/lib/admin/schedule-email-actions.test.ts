import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCHEDULE_EMAIL, type ScheduleEmailConfig } from "@/lib/email/schedule-email";

// Every collaborator is I/O, so they're stubbed: sendEmail never runs for real.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: { EMAIL_FROM: "GDEC Scheduling <no-reply@re.hauge.rocks>" },
}));
const requireAdmin = vi.fn();
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: () => requireAdmin() }));
const sendEmail = vi.fn();
vi.mock("@/lib/email/resend", () => ({ sendEmail: (m: unknown) => sendEmail(m) }));
vi.mock("@/lib/positions/data", () => ({
  positionOptions: async () => [{ id: "ca", name: "Culinary Assistant" }],
}));
const findStudentByEmail = vi.fn();
vi.mock("@/lib/roster/lookup", () => ({
  findStudentByEmail: (e: string) => findStudentByEmail(e),
}));
let config: ScheduleEmailConfig = DEFAULT_SCHEDULE_EMAIL;
let emailEnabled = true;
const setSetting = vi.fn();
vi.mock("@/lib/settings", () => ({
  getEmailSendingEnabled: async () => emailEnabled,
  getScheduleEmailConfig: async () => config,
  setSetting: (k: string, v: string) => setSetting(k, v),
  SETTING_SCHEDULE_EMAIL: "schedule_email",
}));
const updateSubmission = vi.fn();
vi.mock("./update-submission", () => ({
  updateSubmission: (e: string, patch: unknown) => updateSubmission(e, patch),
}));

const { sendScheduleEmail, sendScheduleEmailTest, saveScheduleEmailConfig } =
  await import("./schedule-email-actions");

const input = {
  startDate: "2026-10-04",
  crossoverPosition: "",
  crossoverShift: "",
  firstShiftTime: "",
  includeCc: true,
  requestId: "3f1c2d9e-aaaa-bbbb-cccc-1234567890ab",
};

beforeEach(() => {
  vi.clearAllMocks();
  config = DEFAULT_SCHEDULE_EMAIL;
  emailEnabled = true;
  requireAdmin.mockResolvedValue({ ok: true, email: "sfhauge@wisc.edu" });
  findStudentByEmail.mockResolvedValue({
    email: "sfhauge@wisc.edu",
    displayName: "Stefan Hauge",
    positionId: "ca",
  });
  sendEmail.mockResolvedValue("sent");
  updateSubmission.mockResolvedValue({ ok: true });
});

describe("sendScheduleEmail", () => {
  it("sends with the cc, reply-to, sender and idempotency key, then stamps and marks scheduled", async () => {
    const res = await sendScheduleEmail("SFHauge@wisc.edu", input);
    expect(res).toEqual({
      ok: true,
      message: "Sent to sfhauge@wisc.edu, with a copy to gdec_h-o@g-groups.wisc.edu.",
    });
    const msg = sendEmail.mock.calls[0]![0];
    expect(msg).toMatchObject({
      to: "sfhauge@wisc.edu",
      cc: ["gdec_h-o@g-groups.wisc.edu"],
      replyTo: "gdec_h-o@g-groups.wisc.edu",
      from: "GDEC Scheduling <no-reply@re.hauge.rocks>",
      idempotencyKey: `schedule-email-${input.requestId}`,
    });
    expect(msg.text).toContain("Sunday, October 4");
    expect(updateSubmission).toHaveBeenCalledWith("sfhauge@wisc.edu", {
      scheduleEmailSentAt: expect.any(Date),
      scheduled: true,
    });
  });

  it("leaves out the cc when unticked but keeps the reply-to", async () => {
    await sendScheduleEmail("sfhauge@wisc.edu", { ...input, includeCc: false });
    expect(sendEmail.mock.calls[0]![0]).toMatchObject({
      cc: [],
      replyTo: "gdec_h-o@g-groups.wisc.edu",
    });
  });

  it("only stamps the sent date when marking scheduled is off", async () => {
    config = { ...DEFAULT_SCHEDULE_EMAIL, marksScheduled: false };
    await sendScheduleEmail("sfhauge@wisc.edu", input);
    expect(updateSubmission).toHaveBeenCalledWith("sfhauge@wisc.edu", {
      scheduleEmailSentAt: expect.any(Date),
    });
  });

  it("refuses when email sending is off, without sending or stamping", async () => {
    emailEnabled = false;
    const res = await sendScheduleEmail("sfhauge@wisc.edu", input);
    expect(res.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  it("doesn't stamp when the test guard blocks the message", async () => {
    sendEmail.mockResolvedValue("blocked");
    const res = await sendScheduleEmail("sfhauge@wisc.edu", input);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/EMAIL_TEST_RECIPIENTS/);
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  it("doesn't stamp when Resend refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmail.mockRejectedValue(new Error("Resend send failed (422)"));
    expect((await sendScheduleEmail("sfhauge@wisc.edu", input)).ok).toBe(false);
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  it("rejects bad input and non-admins before sending", async () => {
    expect((await sendScheduleEmail("sfhauge@wisc.edu", { ...input, startDate: "" })).ok).toBe(
      false,
    );
    requireAdmin.mockResolvedValue({ ok: false, error: "Admins only." });
    expect(await sendScheduleEmail("sfhauge@wisc.edu", input)).toEqual({
      ok: false,
      error: "Admins only.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("sendScheduleEmailTest", () => {
  it("sends only to the signed-in admin, with no cc", async () => {
    const res = await sendScheduleEmailTest();
    expect(res.ok).toBe(true);
    expect(sendEmail.mock.calls[0]![0]).toMatchObject({ to: "sfhauge@wisc.edu", cc: [] });
    expect(updateSubmission).not.toHaveBeenCalled();
  });
});

describe("saveScheduleEmailConfig", () => {
  it("stores a valid config", async () => {
    expect(await saveScheduleEmailConfig(DEFAULT_SCHEDULE_EMAIL)).toEqual({ ok: true });
    expect(JSON.parse(setSetting.mock.calls[0]![1])).toEqual(DEFAULT_SCHEDULE_EMAIL);
  });

  it("refuses a broken template", async () => {
    const res = await saveScheduleEmailConfig({ ...DEFAULT_SCHEDULE_EMAIL, body: "{{ nope }}" });
    expect(res.ok).toBe(false);
    expect(setSetting).not.toHaveBeenCalled();
  });
});
