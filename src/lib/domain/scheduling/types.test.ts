import { describe, expect, it } from "vitest";
import { weekendCohortOf, type Cohort } from "./types";

/** Rows as the helper reads them: nothing but a cohort value. */
const rows = (...cohorts: Cohort[]) => cohorts.map((cohort) => ({ cohort }));

describe("weekendCohortOf: a person with one rotation", () => {
  it("has no rotation when nothing they hold is a weekend row", () => {
    expect(weekendCohortOf(rows("weekday", "weekday", "weekday"))).toBeNull();
  });

  it("has no rotation when they hold nothing at all", () => {
    expect(weekendCohortOf([])).toBeNull();
  });

  it("is on a when their weekend rows are a", () => {
    expect(weekendCohortOf(rows("weekday", "a", "weekday", "a"))).toBe("a");
  });

  it("is on b when their weekend rows are b", () => {
    expect(weekendCohortOf(rows("weekday", "b", "b"))).toBe("b");
  });

  it("is on every when their weekend rows are every", () => {
    expect(weekendCohortOf(rows("weekday", "every"))).toBe("every");
  });
});

describe("weekendCohortOf: every dominates", () => {
  // An every-weekend student works both rotation weeks. Answering "a" would
  // halve their weekend hours and judge them against one week of a fortnight
  // they work twice, so every wins wherever it appears.
  it("wins when it comes after a rotation row", () => {
    expect(weekendCohortOf(rows("a", "every"))).toBe("every");
  });

  it("wins when it comes before one", () => {
    expect(weekendCohortOf(rows("every", "a"))).toBe("every");
  });

  it("wins over both rotations at once, wherever it sits", () => {
    expect(weekendCohortOf(rows("b", "every", "a"))).toBe("every");
    expect(weekendCohortOf(rows("weekday", "b", "a", "every"))).toBe("every");
  });
});

describe("weekendCohortOf: rows that mix a and b", () => {
  // The old spellings disagreed here and nowhere else. Taking the first row
  // answered b for [b, a] and a for [a, b]; taking the last answered the
  // opposite. Both read the array order, which is a property of whichever loop
  // built it rather than of the schedule, so this ranks the values instead.
  it("answers a either way round", () => {
    expect(weekendCohortOf(rows("a", "b"))).toBe("a");
    expect(weekendCohortOf(rows("b", "a"))).toBe("a");
  });

  it("gives the same answer however the rows are ordered", () => {
    const answers = new Set([
      weekendCohortOf(rows("weekday", "a", "b")),
      weekendCohortOf(rows("b", "weekday", "a")),
      weekendCohortOf(rows("a", "b", "weekday")),
      weekendCohortOf(rows("b", "a", "weekday")),
    ]);
    expect(answers).toEqual(new Set(["a"]));
  });
});

describe("weekendCohortOf: weekday rows never decide anything", () => {
  it("ignores them wherever they fall", () => {
    expect(weekendCohortOf(rows("weekday", "b", "weekday"))).toBe("b");
    expect(weekendCohortOf(rows("b", "weekday"))).toBe("b");
  });

  it("reads the cohort and not the day, so any row shape works", () => {
    const seats = [
      { day: "sat", cohort: "b" as Cohort, blockId: "we" },
      { day: "sun", cohort: "b" as Cohort, blockId: "we" },
    ];
    expect(weekendCohortOf(seats)).toBe("b");
  });
});
