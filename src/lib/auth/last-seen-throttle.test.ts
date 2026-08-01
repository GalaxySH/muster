import { describe, expect, it } from "vitest";
import { shouldRecord, SEEN_THROTTLE_MS } from "./last-seen-throttle";

describe("shouldRecord", () => {
  it("records when there is no prior write", () => {
    expect(shouldRecord(undefined, 1_000_000)).toBe(true);
  });

  it("skips a write inside the throttle window", () => {
    const start = 1_000_000;
    expect(shouldRecord(start, start + SEEN_THROTTLE_MS - 1)).toBe(false);
  });

  it("records again once the window has elapsed", () => {
    const start = 1_000_000;
    expect(shouldRecord(start, start + SEEN_THROTTLE_MS)).toBe(true);
  });

  it("honors a custom throttle window", () => {
    expect(shouldRecord(0, 500, 1000)).toBe(false);
    expect(shouldRecord(0, 1000, 1000)).toBe(true);
  });
});
