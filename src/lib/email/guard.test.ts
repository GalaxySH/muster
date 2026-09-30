import { describe, expect, it } from "vitest";
import { guardRecipients, parseTestRecipients } from "./guard";

describe("parseTestRecipients", () => {
  it("splits on commas and whitespace, lowercases, and drops blanks", () => {
    expect([...parseTestRecipients(" SFHauge@wisc.edu, ,other@wisc.edu\n")]).toEqual([
      "sfhauge@wisc.edu",
      "other@wisc.edu",
    ]);
  });

  it("is empty for an empty string", () => {
    expect(parseTestRecipients("").size).toBe(0);
  });
});

describe("guardRecipients", () => {
  const allow = parseTestRecipients("sfhauge@wisc.edu");

  it("passes everything through when there is no allowlist (production)", () => {
    expect(guardRecipients({ to: "student@wisc.edu", cc: ["team@wisc.edu"] }, null)).toEqual({
      to: "student@wisc.edu",
      cc: ["team@wisc.edu"],
      dropped: [],
    });
  });

  it("keeps an allowed recipient and drops a cc that is not allowed", () => {
    expect(
      guardRecipients({ to: "SFHAUGE@wisc.edu", cc: ["gdec_h-o@g-groups.wisc.edu"] }, allow),
    ).toEqual({ to: "SFHAUGE@wisc.edu", cc: [], dropped: ["gdec_h-o@g-groups.wisc.edu"] });
  });

  it("blocks the whole message when the main recipient is not allowed", () => {
    expect(guardRecipients({ to: "student@wisc.edu", cc: ["sfhauge@wisc.edu"] }, allow)).toEqual({
      to: null,
      cc: [],
      dropped: ["student@wisc.edu", "sfhauge@wisc.edu"],
    });
  });

  it("sends nothing at all with an empty allowlist", () => {
    expect(guardRecipients({ to: "sfhauge@wisc.edu", cc: [] }, new Set()).to).toBeNull();
  });
});
