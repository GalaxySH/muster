import { describe, it, expect } from "vitest";
import {
  isTravelExcused,
  defaultTravelCutoff,
  decideTravelSubmission,
  LATE_TRAVEL_POLICY,
} from "./travel";

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

describe("decideTravelSubmission", () => {
  const cutoff = new Date("2026-09-01T00:00:00Z");
  const before = new Date("2026-08-20T12:00:00Z");
  const after = new Date("2026-09-02T12:00:00Z");

  it("accepts (excused) before the cutoff under either policy", () => {
    expect(decideTravelSubmission(before, cutoff, "refuse")).toEqual({
      allowed: true,
      excused: true,
    });
    expect(decideTravelSubmission(before, cutoff, "accept-and-flag")).toEqual({
      allowed: true,
      excused: true,
    });
  });

  it("refuses on/after the cutoff under the refuse policy", () => {
    expect(decideTravelSubmission(cutoff, cutoff, "refuse")).toEqual({ allowed: false });
    expect(decideTravelSubmission(after, cutoff, "refuse")).toEqual({ allowed: false });
  });

  it("accepts unexcused on/after the cutoff under accept-and-flag", () => {
    expect(decideTravelSubmission(after, cutoff, "accept-and-flag")).toEqual({
      allowed: true,
      excused: false,
    });
  });

  it("defaults to the active policy (refuse — owner decision 2026-07-09)", () => {
    expect(LATE_TRAVEL_POLICY).toBe("refuse");
    expect(decideTravelSubmission(after, cutoff)).toEqual({ allowed: false });
  });
});

describe("defaultTravelCutoff", () => {
  it("is September 1, midnight Central (06:00 UTC), of the year the form is filled", () => {
    expect(defaultTravelCutoff(new Date("2026-06-19T12:00:00Z")).toISOString()).toBe(
      "2026-09-01T06:00:00.000Z",
    );
  });

  it("treats August entries as before the cutoff and October as after", () => {
    const cutoff = defaultTravelCutoff(new Date("2026-08-15T00:00:00Z"));
    expect(isTravelExcused(new Date("2026-08-31T23:59:00Z"), cutoff)).toBe(true);
    expect(isTravelExcused(new Date("2026-10-01T00:00:00Z"), cutoff)).toBe(false);
  });
});
