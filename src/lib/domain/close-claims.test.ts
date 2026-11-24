import { describe, it, expect } from "vitest";
import {
  CLOSE_START_MINUTES,
  CLOSE_END_MINUTES,
  generateCloseSlotDates,
  closeWeekendKey,
  remainingCapacity,
  canClaimAnotherClose,
  closeClaimsComplete,
  closeClaimsFeasibility,
  closeLeadStatus,
  closeLeadStatusLabel,
  closeSlotFill,
  formatCloseDay,
  groupCloseWeekends,
  closeStepApplies,
  isValidCloseRequirement,
  MAX_CLOSE_REQUIREMENT,
  formatCloseDate,
  formatCloseSlot,
} from "./close-claims";

describe("close-shift constants", () => {
  it("runs 6p to 11:30p", () => {
    expect(CLOSE_START_MINUTES).toBe(18 * 60);
    expect(CLOSE_END_MINUTES).toBe(23 * 60 + 30);
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

describe("isValidCloseRequirement", () => {
  it("takes whole numbers from 0 to the maximum", () => {
    expect(isValidCloseRequirement(0)).toBe(true);
    expect(isValidCloseRequirement(3)).toBe(true);
    expect(isValidCloseRequirement(MAX_CLOSE_REQUIREMENT)).toBe(true);
  });

  it("refuses negatives, fractions, anything past the maximum and non-numbers", () => {
    expect(isValidCloseRequirement(-1)).toBe(false);
    expect(isValidCloseRequirement(2.5)).toBe(false);
    expect(isValidCloseRequirement(MAX_CLOSE_REQUIREMENT + 1)).toBe(false);
    expect(isValidCloseRequirement(Number.NaN)).toBe(false);
  });
});

describe("closeClaimsComplete", () => {
  it("is complete once the lead holds their own number", () => {
    expect(closeClaimsComplete(0, 3)).toBe(false);
    expect(closeClaimsComplete(2, 3)).toBe(false);
    expect(closeClaimsComplete(3, 3)).toBe(true);
    expect(closeClaimsComplete(1, 1)).toBe(true);
  });

  // Lowering a number must not strand a lead who already picked more.
  it("stays complete when the lead holds more than their number", () => {
    expect(closeClaimsComplete(3, 2)).toBe(true);
  });

  it("is complete with nothing picked when nothing is asked", () => {
    expect(closeClaimsComplete(0, 0)).toBe(true);
  });
});

describe("canClaimAnotherClose", () => {
  it("allows picks up to the lead's number and no further", () => {
    expect(canClaimAnotherClose(0, 2)).toBe(true);
    expect(canClaimAnotherClose(1, 2)).toBe(true);
    expect(canClaimAnotherClose(2, 2)).toBe(false);
    expect(canClaimAnotherClose(3, 2)).toBe(false);
    expect(canClaimAnotherClose(0, 0)).toBe(false);
  });
});

describe("closeStepApplies", () => {
  it("hides the step from a lead who owes none", () => {
    expect(closeStepApplies(0)).toBe(false);
    expect(closeStepApplies(1)).toBe(true);
  });
});

describe("closeLeadStatus", () => {
  it("reads short, done or over against the lead's number", () => {
    expect(closeLeadStatus(1, 3)).toBe("short");
    expect(closeLeadStatus(3, 3)).toBe("done");
    expect(closeLeadStatus(3, 2)).toBe("over");
    expect(closeLeadStatus(0, 0)).toBe("done");
  });
});

describe("closeClaimsFeasibility", () => {
  it("compares total capacity against every lead's own number", () => {
    expect(closeClaimsFeasibility({ totalCapacity: 8, requirements: [3, 3, 2] })).toEqual({
      required: 8,
      available: 8,
      feasible: true,
    });
    expect(closeClaimsFeasibility({ totalCapacity: 7, requirements: [3, 3, 2] })).toEqual({
      required: 8,
      available: 7,
      feasible: false,
    });
  });

  it("is trivially feasible with no shift leads", () => {
    expect(closeClaimsFeasibility({ totalCapacity: 0, requirements: [] }).feasible).toBe(true);
  });
});

describe("formatCloseDate", () => {
  it("renders a short weekday, month, day and year label", () => {
    expect(formatCloseDate("2026-09-04")).toBe("Fri Sep 4, 2026");
    expect(formatCloseDate("2026-12-12")).toBe("Sat Dec 12, 2026");
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
    ).toBe("Fri Sep 4, 2026, 6p–11:30p");
  });

  it("uses each slot's own times, not the defaults", () => {
    expect(formatCloseSlot({ date: "2026-12-12", startMinutes: 17 * 60, endMinutes: 23 * 60 })).toBe(
      "Sat Dec 12, 2026, 5p–11p",
    );
  });
});

describe("closeLeadStatusLabel", () => {
  it("says how far short or over a lead is", () => {
    expect(closeLeadStatusLabel(1, 3)).toBe("Short by 2");
    expect(closeLeadStatusLabel(3, 3)).toBe("Done");
    expect(closeLeadStatusLabel(3, 2)).toBe("Over by 1");
  });
});

describe("closeSlotFill", () => {
  it("reads open, full or over", () => {
    expect(closeSlotFill(3, 1)).toEqual({ state: "open", count: 2 });
    expect(closeSlotFill(3, 3)).toEqual({ state: "full" });
    expect(closeSlotFill(2, 3)).toEqual({ state: "over", count: 1 });
  });
});

describe("formatCloseDay", () => {
  it("leaves the year to the heading above it", () => {
    expect(formatCloseDay("2026-11-27")).toBe("Fri Nov 27");
  });
});

describe("groupCloseWeekends", () => {
  const slot = (date: string, kind: "fri" | "sat") => ({ date, kind });

  it("pairs Friday and Saturday and groups weekends by month, in order", () => {
    const months = groupCloseWeekends([
      slot("2026-12-05", "sat"),
      slot("2026-11-27", "fri"),
      slot("2026-12-04", "fri"),
      slot("2026-11-28", "sat"),
    ]);
    expect(months.map((m) => m.label)).toEqual(["November 2026", "December 2026"]);
    expect(months[0]?.weekends).toEqual([
      { key: "2026-11-27", fri: slot("2026-11-27", "fri"), sat: slot("2026-11-28", "sat") },
    ]);
    expect(months[1]?.weekends[0]?.sat?.date).toBe("2026-12-05");
  });

  it("keeps a weekend with only one close", () => {
    const [month] = groupCloseWeekends([slot("2026-12-11", "fri")]);
    expect(month?.weekends).toEqual([
      { key: "2026-12-11", fri: slot("2026-12-11", "fri"), sat: null },
    ]);
  });

  // The weekend is filed under its Friday, even when that Friday has no close.
  it("files a Saturday on the 1st with the month of the Friday before", () => {
    const [month] = groupCloseWeekends([slot("2026-08-01", "sat")]);
    expect(month?.label).toBe("July 2026");
    expect(month?.weekends[0]).toMatchObject({ key: "2026-07-31", fri: null });
  });

  it("returns nothing for no closes", () => {
    expect(groupCloseWeekends([])).toEqual([]);
  });
});
