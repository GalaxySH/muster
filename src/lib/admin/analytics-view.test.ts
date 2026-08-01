import { describe, expect, it } from "vitest";
import { buildAnalyticsView, type AnalyticsStudent } from "./analytics-view";

const NOW = new Date("2026-08-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("buildAnalyticsView", () => {
  it("returns zeroed counts for an empty roster", () => {
    const view = buildAnalyticsView([], NOW);
    expect(view.total).toBe(0);
    expect(view.signedInPercent).toBe(0);
    expect(view.everSignedIn).toBe(0);
    expect(view.neverSignedInPeople).toEqual([]);
  });

  it("counts ever-signed-in vs never and the percentage", () => {
    const students: AnalyticsStudent[] = [
      { email: "a@wisc.edu", displayName: "A", lastSeenAt: ago(HOUR), status: null },
      { email: "b@wisc.edu", displayName: "B", lastSeenAt: ago(DAY), status: null },
      { email: "c@wisc.edu", displayName: "C", lastSeenAt: null, status: null },
      { email: "d@wisc.edu", displayName: "D", lastSeenAt: null, status: null },
    ];
    const view = buildAnalyticsView(students, NOW);
    expect(view.total).toBe(4);
    expect(view.everSignedIn).toBe(2);
    expect(view.neverSignedIn).toBe(2);
    expect(view.signedInPercent).toBe(50);
    expect(view.neverSignedInPeople.map((p) => p.email)).toEqual(["c@wisc.edu", "d@wisc.edu"]);
  });

  it("splits the funnel into never / signed-in-not-submitted / submitted", () => {
    const students: AnalyticsStudent[] = [
      { email: "sub@wisc.edu", displayName: "Sub", lastSeenAt: ago(HOUR), status: "submitted" },
      // Submitted counts as submitted even with no recorded sign-in (e.g. an
      // admin submitted on their behalf before we tracked activity).
      { email: "sub2@wisc.edu", displayName: "Sub2", lastSeenAt: null, status: "submitted" },
      { email: "draft@wisc.edu", displayName: "Draft", lastSeenAt: ago(HOUR), status: "draft" },
      { email: "seen@wisc.edu", displayName: "Seen", lastSeenAt: ago(HOUR), status: null },
      { email: "never@wisc.edu", displayName: "Never", lastSeenAt: null, status: null },
    ];
    const view = buildAnalyticsView(students, NOW);
    expect(view.funnel).toEqual({ neverSignedIn: 1, signedInNotSubmitted: 2, submitted: 2 });
  });

  it("buckets sign-in recency into exclusive windows that sum to everSignedIn", () => {
    const students: AnalyticsStudent[] = [
      { email: "t@wisc.edu", displayName: "T", lastSeenAt: ago(2 * HOUR), status: null },
      { email: "w@wisc.edu", displayName: "W", lastSeenAt: ago(3 * DAY), status: null },
      { email: "m@wisc.edu", displayName: "M", lastSeenAt: ago(20 * DAY), status: null },
      { email: "d@wisc.edu", displayName: "D", lastSeenAt: ago(90 * DAY), status: null },
      { email: "n@wisc.edu", displayName: "N", lastSeenAt: null, status: null },
    ];
    const view = buildAnalyticsView(students, NOW);
    expect(view.recency).toEqual({ today: 1, week: 1, month: 1, dormant: 1 });
    const summed =
      view.recency.today + view.recency.week + view.recency.month + view.recency.dormant;
    expect(summed).toBe(view.everSignedIn);
  });
});
