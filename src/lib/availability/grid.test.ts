import { describe, it, expect } from "vitest";
import { parseTime } from "@/lib/domain/time";
import { buildGridModel } from "./grid";
import { selectionKey, selectionToKeys, keysToSelection, computeCoveredKeys } from "./selection";
import type { ShiftBlock } from "@/lib/domain/types";

function b(id: string, dt: "weekday" | "weekend", start: string, end: string): ShiftBlock {
  return {
    id,
    positionId: "ca",
    dayType: dt,
    start: parseTime(start),
    end: parseTime(end),
    highDemand: false,
  };
}

const blocks: ShiftBlock[] = [
  b("wd-mid", "weekday", "12:30p", "2:30p"),
  b("wd-open", "weekday", "6:30a", "10:15a"),
  b("wd-close", "weekday", "7:45p", "11:30p"),
  b("we-open", "weekend", "8:30a", "11a"),
  b("we-close", "weekend", "7:45p", "11:30p"),
];

describe("buildGridModel", () => {
  it("sorts weekday rows by start and tags open/close", () => {
    const { weekday } = buildGridModel(blocks);
    expect(weekday.rows.map((r) => r.block.id)).toEqual(["wd-open", "wd-mid", "wd-close"]);
    expect(weekday.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(weekday.rows[0]).toMatchObject({ isOpen: true, isClose: false, label: "6:30a–10:15a" });
    expect(weekday.rows[2]).toMatchObject({ isOpen: false, isClose: true });
  });

  it("builds a weekend sub-grid with Sat/Sun columns", () => {
    const { weekend } = buildGridModel(blocks);
    expect(weekend?.days).toEqual(["sat", "sun"]);
    expect(weekend?.rows.map((r) => r.block.id)).toEqual(["we-open", "we-close"]);
  });

  it("returns a null weekend grid for weekday-only positions", () => {
    const weekdayOnly = blocks.filter((x) => x.dayType === "weekday");
    expect(buildGridModel(weekdayOnly).weekend).toBeNull();
  });
});

describe("computeCoveredKeys", () => {
  const cov = [
    b("long", "weekday", "10a", "2p"), // 10a–2p
    b("short", "weekday", "10a", "12:45p"), // ⊆ long
    b("partial", "weekday", "12:30p", "2:30p"), // overlaps but not contained
  ];

  it("marks a block fully inside a selected longer shift on the same day", () => {
    const covered = computeCoveredKeys([{ blockId: "long", day: "mon" }], cov);
    expect(covered.has(selectionKey("short", "mon"))).toBe(true);
    expect(covered.has(selectionKey("partial", "mon"))).toBe(false); // not contained
    expect(covered.has(selectionKey("long", "mon"))).toBe(false); // the selected one itself
  });

  it("is scoped per day", () => {
    const covered = computeCoveredKeys([{ blockId: "long", day: "mon" }], cov);
    expect(covered.has(selectionKey("short", "tue"))).toBe(false);
  });

  it("ignores selections referencing unknown blocks", () => {
    expect(computeCoveredKeys([{ blockId: "ghost", day: "mon" }], cov).size).toBe(0);
  });
});

describe("selection key helpers", () => {
  it("round-trips selection ↔ keys", () => {
    const selection = [
      { blockId: "wd-open", day: "mon" as const },
      { blockId: "we-close", day: "sat" as const },
    ];
    const keys = selectionToKeys(selection);
    expect(keys.has(selectionKey("wd-open", "mon"))).toBe(true);
    expect(keysToSelection(keys)).toEqual(expect.arrayContaining(selection));
    expect(keysToSelection(keys)).toHaveLength(2);
  });
});
