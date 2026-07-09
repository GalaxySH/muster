import { describe, it, expect } from "vitest";
import {
  CHANGE_REQUEST_DAILY_CAP,
  CHANGE_REQUEST_WINDOW_MS,
  MAX_SHIFT_TEXT_LENGTH,
  MAX_COMMENT_LENGTH,
  validateChangeRequest,
  changeRequestRate,
} from "./change-requests";

describe("validateChangeRequest", () => {
  const good = { day: "tue", shiftText: "2p to 5p", comment: "I can no longer work this shift." };

  it("accepts a complete request and returns the trimmed value", () => {
    const r = validateChangeRequest({ ...good, shiftText: "  2p to 5p  ", comment: " x " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ day: "tue", shiftText: "2p to 5p", comment: "x" });
    }
  });

  it("rejects an unknown day", () => {
    const r = validateChangeRequest({ ...good, day: "someday" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/day/i);
  });

  it("requires the shift time text", () => {
    expect(validateChangeRequest({ ...good, shiftText: "   " }).ok).toBe(false);
  });

  it("requires the comment", () => {
    expect(validateChangeRequest({ ...good, comment: "" }).ok).toBe(false);
  });

  it("caps field lengths", () => {
    expect(
      validateChangeRequest({ ...good, shiftText: "x".repeat(MAX_SHIFT_TEXT_LENGTH + 1) }).ok,
    ).toBe(false);
    expect(
      validateChangeRequest({ ...good, comment: "x".repeat(MAX_COMMENT_LENGTH + 1) }).ok,
    ).toBe(false);
    expect(
      validateChangeRequest({ ...good, shiftText: "x".repeat(MAX_SHIFT_TEXT_LENGTH) }).ok,
    ).toBe(true);
  });
});

describe("changeRequestRate", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  it("allows when under the daily cap", () => {
    expect(changeRequestRate([], now)).toEqual({ allowed: true, nextAllowedAt: null });
    expect(changeRequestRate([hoursAgo(1), hoursAgo(2)], now).allowed).toBe(true);
  });

  it("blocks at the cap and reports when the oldest in-window request expires", () => {
    const r = changeRequestRate([hoursAgo(1), hoursAgo(5), hoursAgo(23)], now);
    expect(CHANGE_REQUEST_DAILY_CAP).toBe(3);
    expect(r.allowed).toBe(false);
    expect(r.nextAllowedAt).toEqual(
      new Date(hoursAgo(23).getTime() + CHANGE_REQUEST_WINDOW_MS),
    );
  });

  it("ignores requests older than the rolling window", () => {
    const r = changeRequestRate([hoursAgo(25), hoursAgo(30), hoursAgo(48)], now);
    expect(r.allowed).toBe(true);
  });
});
