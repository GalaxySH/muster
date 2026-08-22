import { describe, it, expect, beforeEach } from "vitest";
import { matchPlan } from "./match";
import type { MatchBlock, W2wPlanRow, W2wPositionMapEntry } from "./types";
import type { Day } from "../types";

/** Invented ids and names shaped like the real W2W account. */
const MAP: W2wPositionMapEntry[] = [
  {
    w2wPositionId: "100",
    w2wPositionName: "GDEC - Stocker",
    musterPositionId: "stocker",
    fillOrder: 0,
  },
  {
    w2wPositionId: "101",
    w2wPositionName: "GDEC - Dock Stocker",
    musterPositionId: "stocker",
    fillOrder: 1,
  },
  {
    w2wPositionId: "200",
    w2wPositionName: "GDEC - SL",
    musterPositionId: "shift-lead",
    fillOrder: 0,
  },
  {
    w2wPositionId: "300",
    w2wPositionName: "GDEC - CA",
    musterPositionId: "culinary-assistant",
    fillOrder: 0,
  },
];

const STOCKER_AM: MatchBlock = {
  id: "stk-wd-am",
  positionId: "stocker",
  dayType: "weekday",
  start: 7 * 60,
  end: 10 * 60 + 30,
  desiredCapacity: 1,
};

const SL_CLOSE: MatchBlock = {
  id: "sl-we-close",
  positionId: "shift-lead",
  dayType: "weekend",
  start: 19 * 60,
  end: 23 * 60 + 30,
  desiredCapacity: null,
};

const BLOCKS: MatchBlock[] = [STOCKER_AM, SL_CLOSE];

let nextSeq = 0;

function planRow(over: Partial<W2wPlanRow> = {}): W2wPlanRow {
  return {
    seq: nextSeq++,
    w2wPositionId: "100",
    w2wPositionName: "GDEC - Stocker",
    category: "",
    description: "",
    day: "mon",
    startTime: "07:00 AM",
    endTime: "10:30 AM",
    duration: "3.50",
    startMinutes: 7 * 60,
    endMinutes: 10 * 60 + 30,
    employeeName: "",
    employeeNumber: "",
    ...over,
  };
}

function stockerWeek(): W2wPlanRow[] {
  const days: Day[] = ["mon", "tue", "wed", "thu", "fri"];
  return days.map((day) => planRow({ day }));
}

describe("matchPlan", () => {
  beforeEach(() => {
    nextSeq = 0;
  });

  it("sums dock and stocker rows into the same block's seat cell", () => {
    // Two W2W positions map onto one Muster position; the dock block's time
    // coincides with the stocker morning block, so both rows land on it.
    const rows = [
      planRow(),
      planRow({ w2wPositionId: "101", w2wPositionName: "GDEC - Dock Stocker" }),
    ];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.rows.map((r) => r.matchedBlockId)).toEqual(["stk-wd-am", "stk-wd-am"]);
    expect(report.rows.map((r) => r.musterPositionId)).toEqual(["stocker", "stocker"]);
    expect(report.matchedCount).toBe(2);
    expect(report.seatCells).toEqual([{ blockId: "stk-wd-am", day: "mon", seats: 2 }]);
    expect(report.unknownPositions).toEqual([]);
    expect(report.unmatched).toEqual([]);
  });

  it("resolves by position id first, then by exact name", () => {
    const rows = [
      // Id wins even when the name says something else.
      planRow({ w2wPositionId: "300", w2wPositionName: "GDEC - Stocker" }),
      // Unknown id falls back to the name.
      planRow({ w2wPositionId: "999", w2wPositionName: "GDEC - Stocker" }),
    ];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.rows[0]!.musterPositionId).toBe("culinary-assistant");
    expect(report.rows[1]!.musterPositionId).toBe("stocker");
  });

  it("treats the name fallback as case-sensitive exact", () => {
    const report = matchPlan(
      [planRow({ w2wPositionId: "999", w2wPositionName: "gdec - stocker" })],
      MAP,
      BLOCKS,
    );
    expect(report.rows[0]!.musterPositionId).toBeNull();
    expect(report.unknownPositions).toEqual([
      { w2wPositionId: "999", w2wPositionName: "gdec - stocker" },
    ]);
  });

  it("reports an unmapped position once and keeps its rows, unmatched", () => {
    const rows = [
      planRow({ w2wPositionId: "888", w2wPositionName: "GDEC - R&C TM" }),
      planRow({ w2wPositionId: "888", w2wPositionName: "GDEC - R&C TM", day: "tue" }),
    ];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.rows).toHaveLength(2);
    expect(report.matchedCount).toBe(0);
    expect(report.unknownPositions).toEqual([
      { w2wPositionId: "888", w2wPositionName: "GDEC - R&C TM" },
    ]);
    expect(report.unmatched).toEqual([
      {
        w2wPositionName: "GDEC - R&C TM",
        musterPositionId: null,
        dayType: "weekday",
        startMinutes: 7 * 60,
        endMinutes: 10 * 60 + 30,
        description: "",
        rowCount: 2,
      },
    ]);
  });

  it("ignores the shift description when matching a block", () => {
    const rows = [
      planRow({
        w2wPositionId: "200",
        w2wPositionName: "GDEC - SL",
        day: "sat",
        startMinutes: 19 * 60,
        endMinutes: 23 * 60 + 30,
        description: "Weekend Close",
      }),
      planRow({
        w2wPositionId: "200",
        w2wPositionName: "GDEC - SL",
        day: "sat",
        startMinutes: 19 * 60,
        endMinutes: 23 * 60 + 30,
      }),
    ];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.rows.map((r) => r.matchedBlockId)).toEqual(["sl-we-close", "sl-we-close"]);
    expect(report.seatCells).toEqual([{ blockId: "sl-we-close", day: "sat", seats: 2 }]);
  });

  it("does not match across day-types or different times", () => {
    const rows = [
      // Right time, wrong day-type: no weekend stocker block exists.
      planRow({ day: "sat" }),
      // Right day, shifted time.
      planRow({ startMinutes: 7 * 60, endMinutes: 10 * 60 }),
    ];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.matchedCount).toBe(0);
    expect(report.unmatched).toHaveLength(2);
    expect(report.unmatched.map((u) => u.dayType).sort()).toEqual(["weekday", "weekend"]);
    // Mapped but unmatched rows are not unknown positions.
    expect(report.unknownPositions).toEqual([]);
  });

  it("groups unmatched shapes and sorts them by position name then start", () => {
    const rows = [
      planRow({
        w2wPositionId: "999",
        w2wPositionName: "ZZ - Late",
        startMinutes: 600,
        endMinutes: 700,
      }),
      planRow({
        w2wPositionId: "998",
        w2wPositionName: "AA - Early",
        startMinutes: 500,
        endMinutes: 600,
      }),
      planRow({
        w2wPositionId: "998",
        w2wPositionName: "AA - Early",
        startMinutes: 300,
        endMinutes: 400,
      }),
      planRow({
        w2wPositionId: "998",
        w2wPositionName: "AA - Early",
        startMinutes: 300,
        endMinutes: 400,
        day: "tue",
      }),
    ];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.unmatched.map((u) => [u.w2wPositionName, u.startMinutes, u.rowCount])).toEqual([
      ["AA - Early", 300, 2],
      ["AA - Early", 500, 1],
      ["ZZ - Late", 600, 1],
    ]);
  });

  it("takes plan seats from the max day and flags uneven weekday counts", () => {
    const rows = [...stockerWeek(), planRow({ day: "mon" })];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.capacity).toEqual([
      {
        blockId: "stk-wd-am",
        positionId: "stocker",
        dayType: "weekday",
        startMinutes: 7 * 60,
        endMinutes: 10 * 60 + 30,
        desiredCapacity: 1,
        planSeats: 2,
        unevenDays: true,
      },
    ]);
  });

  it("reports even counts as even, with the desired capacity passed through", () => {
    const report = matchPlan(stockerWeek(), MAP, BLOCKS);
    expect(report.capacity).toEqual([
      expect.objectContaining({
        blockId: "stk-wd-am",
        planSeats: 1,
        unevenDays: false,
        desiredCapacity: 1,
      }),
    ]);
  });

  it("counts a day with no rows as zero, so a partial week reads uneven", () => {
    const report = matchPlan([planRow({ day: "wed" })], MAP, BLOCKS);
    expect(report.capacity[0]).toMatchObject({ planSeats: 1, unevenDays: true });
  });

  it("measures weekend blocks over Saturday and Sunday only", () => {
    const slRow = (day: Day) =>
      planRow({
        w2wPositionId: "200",
        w2wPositionName: "GDEC - SL",
        day,
        startMinutes: 19 * 60,
        endMinutes: 23 * 60 + 30,
      });
    const even = matchPlan([slRow("sat"), slRow("sun")], MAP, BLOCKS);
    expect(even.capacity[0]).toMatchObject({
      blockId: "sl-we-close",
      planSeats: 1,
      unevenDays: false,
      desiredCapacity: null,
    });
    const uneven = matchPlan([slRow("sat")], MAP, BLOCKS);
    expect(uneven.capacity[0]).toMatchObject({ planSeats: 1, unevenDays: true });
  });

  it("orders seat cells by block then Sunday-first day order", () => {
    const rows = [
      planRow({ day: "fri" }),
      planRow({ day: "mon" }),
      planRow({
        w2wPositionId: "200",
        w2wPositionName: "GDEC - SL",
        day: "sat",
        startMinutes: 19 * 60,
        endMinutes: 23 * 60 + 30,
      }),
    ];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.seatCells).toEqual([
      { blockId: "sl-we-close", day: "sat", seats: 1 },
      { blockId: "stk-wd-am", day: "mon", seats: 1 },
      { blockId: "stk-wd-am", day: "fri", seats: 1 },
    ]);
  });

  it("keeps rows in source order and leaves an empty plan empty", () => {
    const rows = [planRow(), planRow({ day: "tue" }), planRow({ day: "wed" })];
    const report = matchPlan(rows, MAP, BLOCKS);
    expect(report.rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    const empty = matchPlan([], MAP, BLOCKS);
    expect(empty).toEqual({
      rows: [],
      matchedCount: 0,
      unmatched: [],
      unknownPositions: [],
      capacity: [],
      seatCells: [],
    });
  });
});
