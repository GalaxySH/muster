import { describe, it, expect } from "vitest";
import { calendarDate, localDay, matchesStarted } from "./calendar-day";

describe("localDay", () => {
  it("reads the day in the frame the driver built it in", () => {
    // mysql2 materializes a `date` column as new Date(y, m - 1, d), local
    // midnight. Reading that through toISOString lands a day early on any host
    // east of UTC, so the day has to come off the local getters.
    expect(localDay(new Date(2026, 8, 3))).toBe("2026-09-03");
  });

  it("pads single-digit months and days", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("reads the local calendar day whichever side of UTC the host sits", () => {
    // Midnight catches the bug east of UTC and a late evening catches it west,
    // so between them this fails on any host that reads the UTC frame instead.
    expect(localDay(new Date(2026, 8, 3, 0, 0))).toBe("2026-09-03");
    expect(localDay(new Date(2026, 8, 3, 23, 30))).toBe("2026-09-03");
  });
});

describe("matchesStarted", () => {
  const hired = new Date(2026, 8, 3);

  it("compares calendar days, not instants", () => {
    expect(matchesStarted(hired, { mode: "on", date: "2026-09-03" })).toBe(true);
    expect(matchesStarted(new Date(2026, 8, 3, 23, 30), { mode: "on", date: "2026-09-03" })).toBe(
      true,
    );
  });

  it("orders before and after by the day", () => {
    expect(matchesStarted(hired, { mode: "before", date: "2026-09-04" })).toBe(true);
    expect(matchesStarted(hired, { mode: "before", date: "2026-09-03" })).toBe(false);
    expect(matchesStarted(hired, { mode: "after", date: "2026-09-02" })).toBe(true);
    expect(matchesStarted(hired, { mode: "after", date: "2026-09-03" })).toBe(false);
  });

  it("matches nothing when the student has no hire date", () => {
    for (const mode of ["before", "after", "on"] as const) {
      expect(matchesStarted(null, { mode, date: "2026-09-03" })).toBe(false);
    }
  });
});

describe("calendarDate", () => {
  it("round-trips a date input through localDay unchanged", () => {
    // The bug it exists for: `new Date("2026-09-10")` is midnight UTC, which is
    // still the 9th anywhere west of UTC, so the column stored the day before
    // the one the admin typed.
    for (const iso of ["2026-01-01", "2026-09-10", "2026-12-31", "2027-03-14"]) {
      expect(localDay(calendarDate(iso))).toBe(iso);
    }
  });

  it("lands on local midnight, not UTC midnight", () => {
    const d = calendarDate("2026-09-10");
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
    expect(d.getDate()).toBe(10);
  });
});
