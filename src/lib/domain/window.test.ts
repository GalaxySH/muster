import { describe, it, expect } from "vitest";
import { windowState, canEditInWindow, canEditSubmission, isLockedAfterSubmit } from "./window";

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

describe("canEditSubmission", () => {
  it("matches canEditInWindow when the group doesn't lock after submit", () => {
    expect(canEditSubmission("open", false, false)).toBe(true);
    expect(canEditSubmission("open", false, true)).toBe(true); // submitted but no lock
    expect(canEditSubmission("closed", false, false)).toBe(false);
  });

  it("still accepts not-yet-submitted students when the group locks after submit", () => {
    // New submissions are allowed; only post-submit editing is blocked.
    expect(canEditSubmission("open", true, false)).toBe(true);
  });

  it("blocks a submitted student in a lock-after-submit group even while open", () => {
    expect(canEditSubmission("open", true, true)).toBe(false);
  });

  it("never overrides a closed window into editable", () => {
    expect(canEditSubmission("closed", true, true)).toBe(false);
    expect(canEditSubmission("before", true, false)).toBe(false);
  });
});

describe("isLockedAfterSubmit", () => {
  it("is true only when an open window is blocked by the submit lock", () => {
    expect(isLockedAfterSubmit("open", true, true)).toBe(true);
  });

  it("is false without the lock, without a submission, or when not open", () => {
    expect(isLockedAfterSubmit("open", false, true)).toBe(false);
    expect(isLockedAfterSubmit("open", true, false)).toBe(false);
    expect(isLockedAfterSubmit("closed", true, true)).toBe(false);
  });
});
