import { describe, expect, it } from "vitest";
import {
  isDigestDue,
  isDigestSchedulerEnabled,
  mostRecentDigestSendInstant,
} from "./digest-schedule";

// 7:00 AM America/Chicago = 12:00 UTC under CDT (summer), 13:00 UTC under CST.
describe("mostRecentDigestSendInstant", () => {
  it("returns today's 7am Central once it has passed (CDT)", () => {
    const now = new Date("2026-07-15T12:30:00.000Z"); // 7:30 AM CDT
    expect(mostRecentDigestSendInstant(now).toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("returns yesterday's send before 7am Central (CDT)", () => {
    const now = new Date("2026-07-15T11:30:00.000Z"); // 6:30 AM CDT
    expect(mostRecentDigestSendInstant(now).toISOString()).toBe("2026-07-14T12:00:00.000Z");
  });

  it("is DST-correct in winter (CST)", () => {
    const now = new Date("2026-01-15T13:30:00.000Z"); // 7:30 AM CST
    expect(mostRecentDigestSendInstant(now).toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });

  it("uses the campus calendar day, not the UTC one", () => {
    // 02:00 UTC Jul 16 is still 9 PM Jul 15 in Chicago.
    const now = new Date("2026-07-16T02:00:00.000Z");
    expect(mostRecentDigestSendInstant(now).toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("returns exactly the send instant at the send instant", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    expect(mostRecentDigestSendInstant(now).toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("handles the spring-forward day (7am exists, offset flips to CDT)", () => {
    const now = new Date("2026-03-08T13:00:00.000Z"); // 8 AM CDT on the switch day
    expect(mostRecentDigestSendInstant(now).toISOString()).toBe("2026-03-08T12:00:00.000Z");
  });
});

describe("isDigestDue", () => {
  const now = new Date("2026-07-15T12:30:00.000Z"); // 7:30 AM CDT

  it("is due when no run was ever recorded", () => {
    expect(isDigestDue(null, now)).toBe(true);
  });

  it("is due when the last run predates today's send instant", () => {
    expect(isDigestDue(new Date("2026-07-14T12:00:05.000Z"), now)).toBe(true);
  });

  it("is not due again after today's run", () => {
    expect(isDigestDue(new Date("2026-07-15T12:00:05.000Z"), now)).toBe(false);
  });

  it("is not due before 7am when yesterday's run happened", () => {
    const early = new Date("2026-07-15T11:30:00.000Z"); // 6:30 AM CDT
    expect(isDigestDue(new Date("2026-07-14T12:00:05.000Z"), early)).toBe(false);
  });

  it("catches up after multi-day downtime, even before 7am", () => {
    const early = new Date("2026-07-15T09:00:00.000Z"); // 4 AM CDT
    expect(isDigestDue(new Date("2026-07-11T12:00:05.000Z"), early)).toBe(true);
  });

  it("treats a clock-skewed future run as not due", () => {
    expect(isDigestDue(new Date("2026-07-16T12:00:00.000Z"), now)).toBe(false);
  });
});

describe("isDigestSchedulerEnabled", () => {
  it("always runs in production, flag or not", () => {
    expect(isDigestSchedulerEnabled("", "production")).toBe(true);
    expect(isDigestSchedulerEnabled(undefined, "production")).toBe(true);
  });

  it("runs outside production only behind the explicit flag", () => {
    expect(isDigestSchedulerEnabled("1", "development")).toBe(true);
    expect(isDigestSchedulerEnabled("true", "test")).toBe(true);
    expect(isDigestSchedulerEnabled("", "development")).toBe(false);
    expect(isDigestSchedulerEnabled(undefined, undefined)).toBe(false);
    expect(isDigestSchedulerEnabled("0", "development")).toBe(false);
  });
});
