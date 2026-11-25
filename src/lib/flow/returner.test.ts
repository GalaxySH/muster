import { describe, it, expect } from "vitest";
import { calendarDate } from "@/lib/domain/calendar-day";
import { parseHireDate } from "@/lib/roster/parse";
import { isReturningStudent } from "./returner";

// A hire date as the driver hands it back: midnight local time.
const hired = calendarDate;

describe("isReturningStudent", () => {
  // Fall 2026: returners were hired before June 2026.
  const cutoff = "2026-06-01";

  it("is false when the hire date is unknown", () => {
    expect(isReturningStudent(null, cutoff)).toBe(false);
  });

  it("is true for someone hired before the term's cutoff", () => {
    expect(isReturningStudent(hired("2025-08-20"), cutoff)).toBe(true);
  });

  it("is false for someone hired on or after it", () => {
    expect(isReturningStudent(hired("2026-08-18"), cutoff)).toBe(false);
  });

  it("counts a hire on the cutoff day itself as new, not returning", () => {
    expect(isReturningStudent(hired("2026-06-01"), cutoff)).toBe(false);
    expect(isReturningStudent(hired("2026-07-10"), cutoff)).toBe(false);
  });

  it("counts a hire the day before the cutoff as returning", () => {
    expect(isReturningStudent(hired("2026-05-31"), cutoff)).toBe(true);
  });

  // The date the importer builds from the sheet has to agree, in any timezone.
  it("reads the importer's date for the cutoff day as new", () => {
    expect(isReturningStudent(parseHireDate("2026/06/01"), cutoff)).toBe(false);
    expect(isReturningStudent(parseHireDate("2026/05/31"), cutoff)).toBe(true);
  });

  // The cutoff is the term's own, so the same person reads differently next term.
  it("judges the same hire date against whichever term is asking", () => {
    const august = hired("2026-08-18");
    expect(isReturningStudent(august, "2026-06-01")).toBe(false);
    expect(isReturningStudent(august, "2026-10-19")).toBe(true);
  });
});
