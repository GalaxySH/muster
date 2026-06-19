import { describe, it, expect } from "vitest";
import { hourCap } from "./caps";

describe("hourCap", () => {
  it("is 30h for domestic and 20h for international students", () => {
    expect(hourCap(false)).toBe(30);
    expect(hourCap(true)).toBe(20);
  });
});
