import { describe, it, expect } from "vitest";
import { lockedMessage, lockedReasonLine, readOnlyNotice } from "./window-message";

const OPENS = new Date("2026-09-01T12:00:00Z");
const CLOSES = new Date("2026-09-15T12:00:00Z");

describe("lockedMessage", () => {
  it("dates the opens-soon and closed banners", () => {
    expect(lockedMessage("before", OPENS, CLOSES).detail).toContain("It opens");
    expect(lockedMessage("closed", OPENS, CLOSES).detail).toContain("It closed");
  });

  it("says nothing is scheduled when the window is unconfigured", () => {
    const { title, detail } = lockedMessage("unconfigured", null, null);
    expect(title).toMatch(/hasn't been scheduled/);
    expect(detail).not.toBe("");
  });

  it("is empty for an open window", () => {
    expect(lockedMessage("open", OPENS, CLOSES)).toEqual({ title: "", detail: "" });
    expect(lockedReasonLine("open", OPENS, CLOSES)).toBe("");
  });
});

describe("readOnlyNotice", () => {
  it("points at the window the banner shows when one is scheduled", () => {
    expect(readOnlyNotice("before")).toBe(
      "You can't fill out the form until it opens. Check back then.",
    );
    expect(readOnlyNotice("closed")).toBe("You can no longer make changes to your responses.");
  });

  it("says nothing when there's no window to point at", () => {
    // The unconfigured banner already covers it, and there is no date to
    // reference: a "check back during the window above" line would contradict it.
    expect(readOnlyNotice("unconfigured")).toBeNull();
  });

  it("says nothing when the window is open", () => {
    expect(readOnlyNotice("open")).toBeNull();
  });

  it("never references a window when none is displayed", () => {
    expect(readOnlyNotice("unconfigured") ?? "").not.toMatch(/window|above|check back/i);
  });

  it("has no em dashes (UI copy rule)", () => {
    for (const state of ["before", "closed", "unconfigured", "open"] as const) {
      expect(readOnlyNotice(state) ?? "").not.toContain("—");
    }
  });
});
