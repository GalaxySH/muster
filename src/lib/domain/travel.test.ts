import { describe, it, expect } from "vitest";
import { isTravelExcused } from "./travel";

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
