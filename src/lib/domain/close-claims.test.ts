import { describe, it, expect } from "vitest";
import {
  REQUIRED_CLOSE_CLAIMS,
  CLOSE_START_MINUTES,
  CLOSE_END_MINUTES,
  defaultCloseSemesterRange,
  generateCloseSlotDates,
  closeWeekendKey,
  remainingCapacity,
  closeClaimsComplete,
  closeClaimsFeasibility,
  formatCloseDate,
  formatCloseSlot,
} from "./close-claims";

describe("close-shift constants", () => {
  it("requires exactly 3 claims and runs 6p to 11:30p", () => {
    expect(REQUIRED_CLOSE_CLAIMS).toBe(3);
    expect(CLOSE_START_MINUTES).toBe(18 * 60);
    expect(CLOSE_END_MINUTES).toBe(23 * 60 + 30);
  });
});

describe("defaultCloseSemesterRange", () => {
  it("spans the first September weekend through the second December weekend (2026)", () => {
    // Sep 2026: first Friday is Sep 4. Dec 2026 Fridays: 4, 11 → second weekend
    // ends Sat Dec 12.
    const r = defaultCloseSemesterRange(new Date("2026-07-10T12:00:00Z"));
    expect(r).toEqual({ start: "2026-09-04", end: "2026-12-12" });
  });

  it("uses the calendar year of `now` (2027)", () => {
    // Sep 2027: first Friday is Sep 3. Dec 2027 Fridays: 3, 10 → ends Sat Dec 11.
    const r = defaultCloseSemesterRange(new Date("2027-01-15T00:00:00Z"));
    expect(r).toEqual({ start: "2027-09-03", end: "2027-12-11" });
  });
});

describe("generateCloseSlotDates", () => {
  it("lists every Friday and Saturday in the range, in order, with kinds", () => {
    expect(generateCloseSlotDates("2026-09-04", "2026-09-12")).toEqual([
      { date: "2026-09-04", kind: "fri" },
      { date: "2026-09-05", kind: "sat" },
      { date: "2026-09-11", kind: "fri" },
      { date: "2026-09-12", kind: "sat" },
    ]);
  });

  it("includes a Saturday at the start of the range (partial weekend)", () => {
    expect(generateCloseSlotDates("2026-09-05", "2026-09-11")).toEqual([
      { date: "2026-09-05", kind: "sat" },
      { date: "2026-09-11", kind: "fri" },
    ]);
  });

  it("generates 15 weekends (30 slots) for the default 2026 semester", () => {
    const slots = generateCloseSlotDates("2026-09-04", "2026-12-12");
    expect(slots).toHaveLength(30);
    expect(slots.filter((s) => s.kind === "fri")).toHaveLength(15);
    expect(slots[0]).toEqual({ date: "2026-09-04", kind: "fri" });
    expect(slots[slots.length - 1]).toEqual({ date: "2026-12-12", kind: "sat" });
  });

  it("is empty when the range is inverted", () => {
    expect(generateCloseSlotDates("2026-09-10", "2026-09-04")).toEqual([]);
  });
});

describe("closeWeekendKey", () => {
  it("keys a weekend by its Friday", () => {
    expect(closeWeekendKey("2026-09-04", "fri")).toBe("2026-09-04");
    expect(closeWeekendKey("2026-09-05", "sat")).toBe("2026-09-04");
  });

  it("crosses month boundaries for a Saturday", () => {
    // Sat Aug 1 2026 pairs with Fri Jul 31.
    expect(closeWeekendKey("2026-08-01", "sat")).toBe("2026-07-31");
  });
});

describe("remainingCapacity", () => {
  it("subtracts claims and never goes negative", () => {
    expect(remainingCapacity(3, 0)).toBe(3);
    expect(remainingCapacity(3, 2)).toBe(1);
    expect(remainingCapacity(3, 3)).toBe(0);
    expect(remainingCapacity(2, 5)).toBe(0);
  });
});

describe("closeClaimsComplete", () => {
  it("is complete only at 3 or more claims", () => {
    expect(closeClaimsComplete(0)).toBe(false);
    expect(closeClaimsComplete(2)).toBe(false);
    expect(closeClaimsComplete(3)).toBe(true);
  });
});

describe("closeClaimsFeasibility", () => {
  it("compares total capacity against 3 seats per shift lead", () => {
    expect(closeClaimsFeasibility({ totalCapacity: 90, shiftLeadCount: 30 })).toEqual({
      required: 90,
      available: 90,
      feasible: true,
    });
    expect(closeClaimsFeasibility({ totalCapacity: 89, shiftLeadCount: 30 })).toEqual({
      required: 90,
      available: 89,
      feasible: false,
    });
  });

  it("is trivially feasible with no shift leads", () => {
    expect(closeClaimsFeasibility({ totalCapacity: 0, shiftLeadCount: 0 }).feasible).toBe(true);
  });
});

describe("formatCloseDate", () => {
  it("renders a short weekday + month + day label", () => {
    expect(formatCloseDate("2026-09-04")).toBe("Fri Sep 4");
    expect(formatCloseDate("2026-12-12")).toBe("Sat Dec 12");
  });
});

describe("formatCloseSlot", () => {
  it("renders the date and the shift times on one line", () => {
    expect(
      formatCloseSlot({
        date: "2026-09-04",
        startMinutes: CLOSE_START_MINUTES,
        endMinutes: CLOSE_END_MINUTES,
      }),
    ).toBe("Fri Sep 4, 6p–11:30p");
  });

  it("uses each slot's own times, not the defaults", () => {
    expect(formatCloseSlot({ date: "2026-12-12", startMinutes: 17 * 60, endMinutes: 23 * 60 })).toBe(
      "Sat Dec 12, 5p–11p",
    );
  });
});
