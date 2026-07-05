import { describe, it, expect } from "vitest";
import { isAtEvidenceCap, MAX_EXTRACURRICULAR_FILES, MAX_TRAVEL_REQUESTS } from "./limits";

describe("isAtEvidenceCap", () => {
  it("allows adding while below the cap", () => {
    expect(isAtEvidenceCap(0, 10)).toBe(false);
    expect(isAtEvidenceCap(9, 10)).toBe(false);
  });

  it("refuses once the count has reached the cap", () => {
    expect(isAtEvidenceCap(10, 10)).toBe(true);
  });

  it("refuses when somehow already over the cap", () => {
    expect(isAtEvidenceCap(11, 10)).toBe(true);
  });
});

describe("evidence cap constants", () => {
  it("caps extracurricular files at 10 and travel requests at 20", () => {
    expect(MAX_EXTRACURRICULAR_FILES).toBe(10);
    expect(MAX_TRAVEL_REQUESTS).toBe(20);
  });
});
