import { describe, expect, it } from "vitest";
import { isWiscEmail } from "@/lib/auth/policy";
import {
  TEST_ACCOUNT_DOMAIN,
  slugFromName,
  isValidTestSlug,
  testEmailFromSlug,
  isTestAccountEmail,
} from "./email";

describe("slugFromName", () => {
  it("lowercases and hyphenates a display name", () => {
    expect(slugFromName("Casey Trainer")).toBe("casey-trainer");
  });

  it("collapses runs of spaces/punctuation into one hyphen", () => {
    expect(slugFromName("  Casey   Q. Trainer!! ")).toBe("casey-q-trainer");
  });

  it("keeps digits", () => {
    expect(slugFromName("Barista 2")).toBe("barista-2");
  });

  it("trims leading/trailing separators", () => {
    expect(slugFromName("--Casey--")).toBe("casey");
  });

  it("returns empty string when nothing usable remains", () => {
    expect(slugFromName("")).toBe("");
    expect(slugFromName("!!! ***")).toBe("");
  });
});

describe("isValidTestSlug", () => {
  it("accepts simple slugs", () => {
    expect(isValidTestSlug("a")).toBe(true);
    expect(isValidTestSlug("casey-trainer")).toBe(true);
    expect(isValidTestSlug("barista2")).toBe(true);
  });

  it("rejects empty, uppercase, spaces, and edge hyphens", () => {
    expect(isValidTestSlug("")).toBe(false);
    expect(isValidTestSlug("Casey")).toBe(false);
    expect(isValidTestSlug("casey trainer")).toBe(false);
    expect(isValidTestSlug("-casey")).toBe(false);
    expect(isValidTestSlug("casey-")).toBe(false);
  });

  it("rejects slugs longer than 64 chars", () => {
    expect(isValidTestSlug("a".repeat(64))).toBe(true);
    expect(isValidTestSlug("a".repeat(65))).toBe(false);
  });

  it("accepts every slug slugFromName produces (when non-empty)", () => {
    for (const name of ["Casey Trainer", "Barista 2", "  X  ", "A---B"]) {
      const slug = slugFromName(name);
      expect(isValidTestSlug(slug)).toBe(true);
    }
  });
});

describe("testEmailFromSlug / isTestAccountEmail", () => {
  it("composes slug@domain", () => {
    expect(testEmailFromSlug("casey-trainer")).toBe(`casey-trainer@${TEST_ACCOUNT_DOMAIN}`);
  });

  it("recognizes only the exact synthetic domain (case-insensitive)", () => {
    expect(isTestAccountEmail(`x@${TEST_ACCOUNT_DOMAIN}`)).toBe(true);
    expect(isTestAccountEmail(`X@${TEST_ACCOUNT_DOMAIN.toUpperCase()}`)).toBe(true);
    expect(isTestAccountEmail("x@wisc.edu")).toBe(false);
    expect(isTestAccountEmail("x@muster.invalid")).toBe(false);
    expect(isTestAccountEmail(`x@${TEST_ACCOUNT_DOMAIN}.evil.com`)).toBe(false);
    expect(isTestAccountEmail("not-an-email")).toBe(false);
    expect(isTestAccountEmail("")).toBe(false);
  });

  it("round-trips: a derived email is a test-account email", () => {
    expect(isTestAccountEmail(testEmailFromSlug("casey-trainer"))).toBe(true);
  });

  // Guards the security invariant: a synthetic address must never pass the
  // wisc.edu gates, so the ONLY way into a test account is an admin-minted token.
  it("a derived email is never a wisc.edu email", () => {
    expect(isWiscEmail(testEmailFromSlug("casey-trainer"))).toBe(false);
  });
});
