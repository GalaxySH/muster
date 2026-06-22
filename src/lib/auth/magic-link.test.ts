import { describe, it, expect } from "vitest";
import {
  hashToken,
  generateToken,
  magicLinkValidity,
  cooldownRemainingMs,
  MAGIC_LINK_COOLDOWN_MS,
  type MagicLinkCheckRow,
} from "./magic-link";

describe("hashToken / generateToken", () => {
  it("hashes deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("generates a URL-safe token whose stored hash matches", () => {
    const { token, tokenHash } = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toBe(hashToken(token));
    expect(generateToken().token).not.toBe(token); // random
  });
});

describe("magicLinkValidity", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const base: MagicLinkCheckRow = {
    studentEmail: "a@wisc.edu",
    expiresAt: new Date("2026-08-15T12:30:00Z"),
    redeemedAt: null,
    revokedAt: null,
  };

  it("accepts a fresh, matching, unredeemed token", () => {
    expect(magicLinkValidity(base, "a@wisc.edu", now)).toBe("ok");
  });

  it("rejects an email that doesn't match the bound identity", () => {
    expect(magicLinkValidity(base, "b@wisc.edu", now)).toBe("email_mismatch");
  });

  it("rejects revoked, redeemed, and expired tokens", () => {
    expect(magicLinkValidity({ ...base, revokedAt: now }, "a@wisc.edu", now)).toBe("revoked");
    expect(magicLinkValidity({ ...base, redeemedAt: now }, "a@wisc.edu", now)).toBe("redeemed");
    expect(
      magicLinkValidity({ ...base, expiresAt: new Date("2026-08-15T11:59:59Z") }, "a@wisc.edu", now),
    ).toBe("expired");
  });

  it("treats the exact expiry instant as expired (half-open)", () => {
    expect(magicLinkValidity({ ...base, expiresAt: now }, "a@wisc.edu", now)).toBe("expired");
  });
});

describe("cooldownRemainingMs", () => {
  const now = new Date("2026-08-15T12:00:00Z");

  it("allows immediately when never requested", () => {
    expect(cooldownRemainingMs(null, now)).toBe(0);
  });

  it("blocks within the window and clears after it", () => {
    const justNow = new Date(now.getTime() - 10_000);
    expect(cooldownRemainingMs(justNow, now)).toBe(MAGIC_LINK_COOLDOWN_MS - 10_000);
    const old = new Date(now.getTime() - MAGIC_LINK_COOLDOWN_MS - 1);
    expect(cooldownRemainingMs(old, now)).toBe(0);
  });
});
