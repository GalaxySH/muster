import { describe, it, expect } from "vitest";
import { windowState, canEditInWindow } from "./window";

const opens = new Date("2026-08-15T00:00:00Z");
const closes = new Date("2026-08-22T00:00:00Z");

describe("windowState", () => {
  it("is unconfigured when either bound is missing", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    expect(windowState(null, null, now)).toBe("unconfigured");
    expect(windowState(opens, null, now)).toBe("unconfigured");
    expect(windowState(null, closes, now)).toBe("unconfigured");
  });

  it("is before when now precedes the open instant", () => {
    expect(windowState(opens, closes, new Date("2026-08-14T23:59:59Z"))).toBe("before");
  });

  it("is open from the open instant (inclusive) up to close (exclusive)", () => {
    expect(windowState(opens, closes, opens)).toBe("open"); // exactly at open
    expect(windowState(opens, closes, new Date("2026-08-18T12:00:00Z"))).toBe("open");
    expect(windowState(opens, closes, new Date("2026-08-21T23:59:59Z"))).toBe("open");
  });

  it("is closed from the close instant (inclusive) onward", () => {
    expect(windowState(opens, closes, closes)).toBe("closed"); // exactly at close
    expect(windowState(opens, closes, new Date("2026-08-25T00:00:00Z"))).toBe("closed");
  });
});

describe("canEditInWindow", () => {
  it("permits edits only when open", () => {
    expect(canEditInWindow("open")).toBe(true);
    expect(canEditInWindow("before")).toBe(false);
    expect(canEditInWindow("closed")).toBe(false);
    expect(canEditInWindow("unconfigured")).toBe(false);
  });
});
