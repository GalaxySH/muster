import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  emailDomain,
  isWiscEmail,
  isAllowedGoogleSignIn,
  isAdminEmail,
} from "./policy";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Stu@WISC.edu ")).toBe("stu@wisc.edu");
  });
});

describe("emailDomain", () => {
  it("extracts the lowercased domain", () => {
    expect(emailDomain("stu@WISC.edu")).toBe("wisc.edu");
  });
  it("returns null for malformed addresses", () => {
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain("@wisc.edu")).toBeNull();
    expect(emailDomain("user@")).toBeNull();
  });
});

describe("isWiscEmail", () => {
  it("accepts wisc.edu and rejects others", () => {
    expect(isWiscEmail("stu@wisc.edu")).toBe(true);
    expect(isWiscEmail("stu@cs.wisc.edu")).toBe(false); // subdomain is not the org domain
    expect(isWiscEmail("stu@gmail.com")).toBe(false);
  });
});

describe("isAllowedGoogleSignIn", () => {
  it("allows a verified wisc.edu identity", () => {
    expect(
      isAllowedGoogleSignIn({ email: "stu@wisc.edu", emailVerified: true, hd: "wisc.edu" }),
    ).toBe(true);
  });
  it("allows when emailVerified is absent (Workspace default)", () => {
    expect(isAllowedGoogleSignIn({ email: "stu@wisc.edu" })).toBe(true);
  });
  it("rejects non-wisc domains", () => {
    expect(isAllowedGoogleSignIn({ email: "someone@gmail.com", emailVerified: true })).toBe(false);
  });
  it("rejects an explicitly unverified email", () => {
    expect(isAllowedGoogleSignIn({ email: "stu@wisc.edu", emailVerified: false })).toBe(false);
  });
  it("rejects a mismatched hd claim even with a wisc-looking email", () => {
    expect(isAllowedGoogleSignIn({ email: "stu@wisc.edu", hd: "evil.com" })).toBe(false);
  });
  it("rejects a missing email", () => {
    expect(isAllowedGoogleSignIn({ email: null })).toBe(false);
  });
});

describe("isAdminEmail", () => {
  const allowlist = new Set(["scheduler@wisc.edu", "boss@wisc.edu"]);
  it("matches allowlisted emails case-insensitively", () => {
    expect(isAdminEmail("Scheduler@Wisc.edu", allowlist)).toBe(true);
  });
  it("rejects non-allowlisted emails", () => {
    expect(isAdminEmail("stu@wisc.edu", allowlist)).toBe(false);
  });
});
