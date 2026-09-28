import { describe, it, expect } from "vitest";
import {
  CHANGE_REQUEST_DAILY_CAP,
  CHANGE_REQUEST_WINDOW_MS,
  MAX_SHIFT_TEXT_LENGTH,
  MAX_COMMENT_LENGTH,
  validateChangeRequest,
  changeRequestRate,
  changeRequestDayLabel,
  CHANGE_REQUEST_DAYS,
  CHANGE_REQUEST_DAY_OPTIONS,
  shiftTimeOptions,
  insertShiftTime,
  type ShiftTimeBlock,
} from "./change-requests";

describe("validateChangeRequest", () => {
  const good = {
    day: "tue",
    shiftText: "2p to 5p",
    comment: "I can no longer work this shift.",
    permanent: false,
  };

  it("accepts a complete request and returns the trimmed value", () => {
    const r = validateChangeRequest({ ...good, shiftText: "  2p to 5p  ", comment: " x " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ day: "tue", shiftText: "2p to 5p", comment: "x", permanent: false });
    }
  });

  it("carries the permanent flag through", () => {
    const r = validateChangeRequest({ ...good, permanent: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.permanent).toBe(true);
  });

  it("accepts multiple days", () => {
    const r = validateChangeRequest({ ...good, day: "multiple" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.day).toBe("multiple");
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

describe("changeRequestDayLabel", () => {
  it("labels one day short and several days in words", () => {
    expect(changeRequestDayLabel("tue")).toBe("Tue");
    expect(changeRequestDayLabel("multiple")).toBe("Multiple days");
  });
});

describe("CHANGE_REQUEST_DAY_OPTIONS", () => {
  it("offers every valid day once, starting with Multiple", () => {
    const values = CHANGE_REQUEST_DAY_OPTIONS.map((o) => o.value);
    expect(values[0]).toBe("multiple");
    expect([...values].sort()).toEqual([...CHANGE_REQUEST_DAYS].sort());
  });
});

describe("shiftTimeOptions", () => {
  const h = (hours: number) => hours * 60;
  const blocks: ShiftTimeBlock[] = [
    { dayType: "weekday", start: h(16), end: h(20) },
    { dayType: "weekday", start: h(7), end: h(11) },
    { dayType: "weekday", start: h(7), end: h(10) },
    { dayType: "weekend", start: h(9), end: h(13) },
    // Same span as a weekday block: one pill under "multiple".
    { dayType: "weekend", start: h(16), end: h(20) },
    { dayType: "weekend", start: h(19), end: h(24) },
  ];

  it("shows a weekday's blocks, sorted by start then end", () => {
    expect(shiftTimeOptions(blocks, "wed")).toEqual(["7a to 10a", "7a to 11a", "4p to 8p"]);
  });

  it("shows the weekend blocks on Saturday and Sunday", () => {
    expect(shiftTimeOptions(blocks, "sat")).toEqual(["9a to 1p", "4p to 8p", "7p to 12a"]);
    expect(shiftTimeOptions(blocks, "sun")).toEqual(shiftTimeOptions(blocks, "sat"));
  });

  it("shows every distinct span for multiple days", () => {
    expect(shiftTimeOptions(blocks, "multiple")).toEqual([
      "7a to 10a",
      "7a to 11a",
      "9a to 1p",
      "4p to 8p",
      "7p to 12a",
    ]);
  });

  it("is empty with no blocks", () => {
    expect(shiftTimeOptions([], "multiple")).toEqual([]);
  });
});

describe("insertShiftTime", () => {
  it("fills an empty box", () => {
    expect(insertShiftTime("", "4p to 8p")).toBe("4p to 8p");
    expect(insertShiftTime("   ", "4p to 8p")).toBe("4p to 8p");
  });

  it("appends to what is already there", () => {
    expect(insertShiftTime("7a to 11a", "4p to 8p")).toBe("7a to 11a, 4p to 8p");
    expect(insertShiftTime("7a to 11a, ", "4p to 8p")).toBe("7a to 11a, 4p to 8p");
  });

  it("leaves the text alone when the time is already listed", () => {
    expect(insertShiftTime("7a to 11a, 4p to 8p", "4p to 8p")).toBe("7a to 11a, 4p to 8p");
    expect(insertShiftTime("4p to 8p", "4p to 8p")).toBe("4p to 8p");
  });
});
