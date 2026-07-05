import { describe, it, expect } from "vitest";
import {
  hashToken,
  generateToken,
  magicLinkValidity,
  cooldownRemainingMs,
  admitGlobalSend,
  MAGIC_LINK_COOLDOWN_MS,
  MAGIC_LINK_GLOBAL_MAX,
  MAGIC_LINK_GLOBAL_WINDOW_MS,
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

describe("admitGlobalSend", () => {
  const NOW = 1_000_000;
  const WIN = 60_000;

  it("allows and records a send when under the cap", () => {
    const { allowed, timestamps } = admitGlobalSend([], NOW, 3, WIN);
    expect(allowed).toBe(true);
    expect(timestamps).toEqual([NOW]); // the new send is appended
  });

  it("blocks once the cap is reached in the window and consumes no slot", () => {
    const full = [NOW - 3, NOW - 2, NOW - 1];
    const { allowed, timestamps } = admitGlobalSend(full, NOW, 3, WIN);
    expect(allowed).toBe(false);
    expect(timestamps).toEqual(full); // unchanged — nothing appended when blocked
  });

  it("evicts timestamps outside the rolling window so the budget refills", () => {
    // All prior sends predate the window → all dropped, so a send is allowed.
    const stale = [NOW - 90_000, NOW - 70_000, NOW - 61_000];
    const { allowed, timestamps } = admitGlobalSend(stale, NOW, 3, WIN);
    expect(allowed).toBe(true);
    expect(timestamps).toEqual([NOW]);
  });

  it("keeps only in-window entries and appends the new one", () => {
    const mixed = [NOW - 61_000, NOW - 30_000, NOW - 5_000]; // one stale, two live
    const { allowed, timestamps } = admitGlobalSend(mixed, NOW, 3, WIN);
    expect(allowed).toBe(true); // only 2 live < cap of 3
    expect(timestamps).toEqual([NOW - 30_000, NOW - 5_000, NOW]);
  });

  it("treats an entry exactly one window old as expired (half-open)", () => {
    const { allowed, timestamps } = admitGlobalSend([NOW - WIN], NOW, 1, WIN);
    expect(allowed).toBe(true); // the boundary entry is evicted, freeing the slot
    expect(timestamps).toEqual([NOW]);
  });

  it("is a GLOBAL cap across distinct emails, not a per-email cooldown", () => {
    // Two different addresses each sent within the window fill a global cap of 2,
    // even though neither would be blocked by its own per-email cooldown.
    const twoDistinct = [NOW - 5_000, NOW - 2_000];
    expect(admitGlobalSend(twoDistinct, NOW, 2, WIN).allowed).toBe(false);
  });

  it("defaults to 20 sends per 60s", () => {
    expect(MAGIC_LINK_GLOBAL_MAX).toBe(20);
    expect(MAGIC_LINK_GLOBAL_WINDOW_MS).toBe(60_000);
    const full = Array.from({ length: 20 }, (_, i) => NOW - i * 100);
    expect(admitGlobalSend(full, NOW).allowed).toBe(false); // 20 in-window → blocked
    expect(admitGlobalSend(full.slice(1), NOW).allowed).toBe(true); // 19 in-window → ok
  });
});
