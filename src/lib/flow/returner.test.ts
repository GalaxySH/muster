import { describe, it, expect } from "vitest";
import { isReturningStudent, returnerCutoff } from "./returner";

describe("returnerCutoff", () => {
  it("is June 1 of the current year once the fall cycle is under way", () => {
    // Late August: the fall 2026 cycle. Returners were hired before June 2026.
    expect(returnerCutoff(new Date("2026-08-25T12:00:00Z")).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("rolls back to the previous June before June of a given year (spring usage)", () => {
    // Spring 2026 still belongs to the cycle that started fall 2025.
    expect(returnerCutoff(new Date("2026-03-15T12:00:00Z")).toISOString()).toBe(
      "2025-06-01T00:00:00.000Z",
    );
  });

  it("treats June itself as the start of the new cycle", () => {
    expect(returnerCutoff(new Date("2026-06-01T00:00:00Z")).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });
});

describe("isReturningStudent", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it("is false when the hire date is unknown", () => {
    expect(isReturningStudent(null, now)).toBe(false);
  });

  it("is true for someone hired in a previous cycle", () => {
    expect(isReturningStudent(new Date("2025-08-20T00:00:00Z"), now)).toBe(true);
  });

  it("is false for someone hired this cycle (on/after June 1)", () => {
    expect(isReturningStudent(new Date("2026-08-18T00:00:00Z"), now)).toBe(false);
  });

  it("counts a summer (June/July) hire as new, not returning", () => {
    expect(isReturningStudent(new Date("2026-06-01T00:00:00Z"), now)).toBe(false);
    expect(isReturningStudent(new Date("2026-07-10T00:00:00Z"), now)).toBe(false);
  });

  it("counts a hire the day before the cutoff as returning", () => {
    expect(isReturningStudent(new Date("2026-05-31T00:00:00Z"), now)).toBe(true);
  });
});
