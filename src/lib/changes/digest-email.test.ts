import { describe, it, expect } from "vitest";
import { buildChangeDigestEmail, type DigestEmailRequest } from "./digest-email";

const req = (over: Partial<DigestEmailRequest> = {}): DigestEmailRequest => ({
  id: "req-1",
  studentName: "Ada Lovelace",
  studentEmail: "ada@wisc.edu",
  day: "tue",
  shiftText: "2p to 5p",
  comment: "I can no longer work this shift.",
  createdAt: new Date("2026-10-01T15:00:00Z"),
  ...over,
});

describe("buildChangeDigestEmail", () => {
  it("counts the requests in the subject", () => {
    const one = buildChangeDigestEmail([req()], "https://muster.test");
    expect(one.subject).toBe("1 new schedule change request");
    const three = buildChangeDigestEmail(
      [req(), req({ id: "req-2" }), req({ id: "req-3" })],
      "https://muster.test",
    );
    expect(three.subject).toBe("3 new schedule change requests");
  });

  it("groups requests by student with day, shift, and comment", () => {
    const { text } = buildChangeDigestEmail(
      [
        req(),
        req({ id: "req-2", day: "fri", shiftText: "close", comment: "Please add me here." }),
        req({
          id: "req-3",
          studentName: "Grace Hopper",
          studentEmail: "grace@wisc.edu",
          day: "sun",
          comment: "Swap request.",
        }),
      ],
      "https://muster.test",
    );
    expect(text).toContain("Ada Lovelace (ada@wisc.edu)");
    expect(text).toContain("- Tue 2p to 5p: I can no longer work this shift.");
    expect(text).toContain("- Fri close: Please add me here.");
    expect(text).toContain("Grace Hopper (grace@wisc.edu)");
    expect(text).toContain("- Sun 2p to 5p: Swap request.");
  });

  it("gives every request its own deep link into the admin view", () => {
    const { text, html } = buildChangeDigestEmail(
      [
        req(),
        req({ id: "req-2", studentName: "Grace Hopper", studentEmail: "grace@wisc.edu" }),
      ],
      "https://muster.test",
    );
    const ada = "https://muster.test/admin/students/ada%40wisc.edu#change-request-req-1";
    const grace = "https://muster.test/admin/students/grace%40wisc.edu#change-request-req-2";
    expect(text).toContain(ada);
    expect(text).toContain(grace);
    expect(html).toContain(`href="${ada}"`);
    expect(html).toContain(`href="${grace}"`);
  });

  it("escapes student-controlled text in the html body", () => {
    const { html } = buildChangeDigestEmail(
      [req({ comment: '<script>alert("x")</script>' })],
      "https://muster.test",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
