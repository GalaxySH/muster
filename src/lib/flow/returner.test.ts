import { describe, it, expect } from "vitest";
import { isReturningStudent, newHireCutoff } from "./returner";

describe("newHireCutoff", () => {
  it("is UTC midnight on the term's date, the way hire dates are stored", () => {
    expect(newHireCutoff("2026-06-01").toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("isReturningStudent", () => {
  // Fall 2026: returners were hired before June 2026.
  const cutoff = "2026-06-01";

  it("is false when the hire date is unknown", () => {
    expect(isReturningStudent(null, cutoff)).toBe(false);
  });

  it("is true for someone hired before the term's cutoff", () => {
    expect(isReturningStudent(new Date("2025-08-20T00:00:00Z"), cutoff)).toBe(true);
  });

  it("is false for someone hired on or after it", () => {
    expect(isReturningStudent(new Date("2026-08-18T00:00:00Z"), cutoff)).toBe(false);
  });

  it("counts a hire on the cutoff day itself as new, not returning", () => {
    expect(isReturningStudent(new Date("2026-06-01T00:00:00Z"), cutoff)).toBe(false);
    expect(isReturningStudent(new Date("2026-07-10T00:00:00Z"), cutoff)).toBe(false);
  });

  it("counts a hire the day before the cutoff as returning", () => {
    expect(isReturningStudent(new Date("2026-05-31T00:00:00Z"), cutoff)).toBe(true);
  });

  // The cutoff is the term's own, so the same person reads differently next term.
  it("judges the same hire date against whichever term is asking", () => {
    const hired = new Date("2026-08-18T00:00:00Z");
    expect(isReturningStudent(hired, "2026-06-01")).toBe(false);
    expect(isReturningStudent(hired, "2026-10-19")).toBe(true);
  });
});
