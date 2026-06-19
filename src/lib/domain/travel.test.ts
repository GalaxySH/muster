import { describe, it, expect } from "vitest";
import { isTravelExcused, defaultTravelCutoff } from "./travel";

describe("isTravelExcused", () => {
  const cutoff = new Date("2026-09-01T00:00:00Z"); // global 9/1 cutoff

  it("excuses travel created before the cutoff", () => {
    expect(isTravelExcused(new Date("2026-08-20T12:00:00Z"), cutoff)).toBe(true);
  });

  it("does not excuse travel created on or after the cutoff (late)", () => {
    expect(isTravelExcused(new Date("2026-09-01T00:00:00Z"), cutoff)).toBe(false);
    expect(isTravelExcused(new Date("2026-09-06T09:00:00Z"), cutoff)).toBe(false);
  });
});

describe("defaultTravelCutoff", () => {
  it("is September 1 of the year the form is filled", () => {
    expect(defaultTravelCutoff(new Date("2026-06-19T12:00:00Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("treats August entries as before the cutoff and October as after", () => {
    const cutoff = defaultTravelCutoff(new Date("2026-08-15T00:00:00Z"));
    expect(isTravelExcused(new Date("2026-08-31T23:59:00Z"), cutoff)).toBe(true);
    expect(isTravelExcused(new Date("2026-10-01T00:00:00Z"), cutoff)).toBe(false);
  });
});
