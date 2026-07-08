import { describe, it, expect } from "vitest";
import { upcomingTravel } from "./upcoming-travel";

type E = { name: string; startDate: string; endDate: string };
const e = (name: string, startDate: string, endDate: string): E => ({ name, startDate, endDate });

// 2026-01-04 is a Sunday, so the week starts are 01-04, 01-11, 01-18, 01-25, ...
// "now" is Tue 2026-01-06; the 3-week horizon runs through 2026-01-27.
const now = new Date("2026-01-06T12:00:00Z");
const weekStarts = (r: { weekStart: string }[]) => r.map((w) => w.weekStart);

describe("upcomingTravel", () => {
  it("buckets current + upcoming travel by Sunday-started week", () => {
    const result = upcomingTravel(
      [
        e("Ann", "2026-01-06", "2026-01-06"), // this week
        e("Bob", "2026-01-14", "2026-01-16"), // next-next week (01-11)
      ],
      now,
    );
    expect(weekStarts(result)).toEqual(["2026-01-04", "2026-01-11"]);
    expect(result[0]!.entries.map((x) => x.name)).toEqual(["Ann"]);
    expect(result[1]!.entries.map((x) => x.name)).toEqual(["Bob"]);
  });

  it("excludes travel that already ended", () => {
    expect(upcomingTravel([e("Past", "2026-01-02", "2026-01-04")], now)).toEqual([]);
  });

  it("excludes travel beyond the 3-week horizon", () => {
    expect(upcomingTravel([e("Far", "2026-03-01", "2026-03-05")], now)).toEqual([]);
  });

  it("includes travel already underway (started before today, ends later)", () => {
    const result = upcomingTravel([e("Now", "2026-01-04", "2026-01-08")], now);
    expect(weekStarts(result)).toEqual(["2026-01-04"]);
  });

  it("lists a range spanning a week boundary under each week it touches", () => {
    const result = upcomingTravel([e("Span", "2026-01-24", "2026-01-28")], now);
    // Sat 01-24 is in the 01-18 week; Sun 01-25 onward is in the 01-25 week.
    expect(weekStarts(result)).toEqual(["2026-01-18", "2026-01-25"]);
    expect(result.every((w) => w.entries[0]!.name === "Span")).toBe(true);
  });

  it("orders entries within a week by start date, then input (name) order", () => {
    const result = upcomingTravel(
      [
        e("Cara", "2026-01-13", "2026-01-13"),
        e("Amy", "2026-01-12", "2026-01-12"),
        e("Bev", "2026-01-12", "2026-01-12"),
      ],
      now,
    );
    expect(weekStarts(result)).toEqual(["2026-01-11"]);
    expect(result[0]!.entries.map((x) => x.name)).toEqual(["Amy", "Bev", "Cara"]);
  });

  it("honors a custom horizon length", () => {
    // 1-week horizon (through 2026-01-13) drops the 01-14 entry.
    const result = upcomingTravel(
      [e("Soon", "2026-01-07", "2026-01-07"), e("Later", "2026-01-14", "2026-01-14")],
      now,
      1,
    );
    expect(weekStarts(result)).toEqual(["2026-01-04"]);
    expect(result[0]!.entries.map((x) => x.name)).toEqual(["Soon"]);
  });
});
