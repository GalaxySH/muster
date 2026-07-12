import { describe, it, expect } from "vitest";
import { parseTime } from "./time";
import { carryOverSelections, type CarryOverRow } from "./carry-over";
import type { Day, DayType, ShiftBlock } from "./types";

function block(id: string, dayType: DayType, start: string, end: string): ShiftBlock {
  return { id, positionId: "src", dayType, start: parseTime(start), end: parseTime(end) };
}

// Source position blocks: a duplicate-time weekday pair, one unmatched weekday
// block, one weekend block, and a weekend block sharing the weekday pair's times.
const sourceBlocks: ShiftBlock[] = [
  block("src-wd-open", "weekday", "8a", "12p"),
  block("src-wd-dup", "weekday", "8a", "12p"),
  block("src-wd-mid", "weekday", "11a", "3p"),
  block("src-we-open", "weekend", "9a", "1p"),
  block("src-we-morning", "weekend", "8a", "12p"),
];

// Target position blocks: time-identical counterparts for src-wd-open/dup and
// src-we-open only.
const targetBlocks: ShiftBlock[] = [
  { id: "tgt-wd-open", positionId: "tgt", dayType: "weekday", start: parseTime("8a"), end: parseTime("12p") },
  { id: "tgt-we-open", positionId: "tgt", dayType: "weekend", start: parseTime("9a"), end: parseTime("1p") },
];

const sel = (blockId: string, day: Day, autoAssigned = false): CarryOverRow => ({
  blockId,
  day,
  autoAssigned,
});

describe("carryOverSelections", () => {
  it("re-points a selection to the time-identical target block, keeping day and autoAssigned", () => {
    const { kept, dropped } = carryOverSelections(
      [sel("src-wd-open", "mon"), sel("src-we-open", "sat", true)],
      sourceBlocks,
      targetBlocks,
    );
    expect(kept).toEqual([
      { blockId: "tgt-wd-open", day: "mon", autoAssigned: false },
      { blockId: "tgt-we-open", day: "sat", autoAssigned: true },
    ]);
    expect(dropped).toEqual([]);
  });

  it("drops a selection whose block has no time-identical counterpart", () => {
    const original = sel("src-wd-mid", "tue");
    const { kept, dropped } = carryOverSelections([original], sourceBlocks, targetBlocks);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([original]);
  });

  it("requires the day-type to match, not just the times", () => {
    // src-we-morning is 8a-12p like tgt-wd-open, but weekend vs weekday.
    const original = sel("src-we-morning", "sun");
    const { kept, dropped } = carryOverSelections([original], sourceBlocks, targetBlocks);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([original]);
  });

  it("drops a stale selection referencing a block outside the source set", () => {
    const original = sel("gone-block", "mon");
    const { kept, dropped } = carryOverSelections([original], sourceBlocks, targetBlocks);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([original]);
  });

  it("keeps the same selection on different days as separate rows", () => {
    const { kept, dropped } = carryOverSelections(
      [sel("src-wd-open", "mon"), sel("src-wd-open", "wed")],
      sourceBlocks,
      targetBlocks,
    );
    expect(kept).toEqual([
      { blockId: "tgt-wd-open", day: "mon", autoAssigned: false },
      { blockId: "tgt-wd-open", day: "wed", autoAssigned: false },
    ]);
    expect(dropped).toEqual([]);
  });

  it("dedupes two identical-time source blocks landing on the same target and day", () => {
    const a = sel("src-wd-open", "mon");
    const b = sel("src-wd-dup", "mon");
    const { kept, dropped } = carryOverSelections([a, b], sourceBlocks, targetBlocks);
    expect(kept).toEqual([{ blockId: "tgt-wd-open", day: "mon", autoAssigned: false }]);
    expect(dropped).toEqual([b]);
  });

  it("prefers the non-autoAssigned row when deduping, regardless of order", () => {
    const auto = sel("src-wd-open", "mon", true);
    const manual = sel("src-wd-dup", "mon", false);

    const autoFirst = carryOverSelections([auto, manual], sourceBlocks, targetBlocks);
    expect(autoFirst.kept).toEqual([{ blockId: "tgt-wd-open", day: "mon", autoAssigned: false }]);
    expect(autoFirst.dropped).toEqual([auto]);

    const manualFirst = carryOverSelections([manual, auto], sourceBlocks, targetBlocks);
    expect(manualFirst.kept).toEqual([{ blockId: "tgt-wd-open", day: "mon", autoAssigned: false }]);
    expect(manualFirst.dropped).toEqual([auto]);
  });

  it("keeps the first row when duplicates share the same autoAssigned state", () => {
    const a = sel("src-wd-open", "mon", true);
    const b = sel("src-wd-dup", "mon", true);
    const { kept, dropped } = carryOverSelections([a, b], sourceBlocks, targetBlocks);
    expect(kept).toEqual([{ blockId: "tgt-wd-open", day: "mon", autoAssigned: true }]);
    expect(dropped).toEqual([b]);
  });

  it("partitions the input: every selection lands in kept or dropped exactly once", () => {
    const selections = [
      sel("src-wd-open", "mon"),
      sel("src-wd-dup", "mon"),
      sel("src-wd-mid", "tue"),
      sel("src-we-open", "sat", true),
      sel("gone-block", "fri"),
    ];
    const { kept, dropped } = carryOverSelections(selections, sourceBlocks, targetBlocks);
    expect(kept.length + dropped.length).toBe(selections.length);
    // Dropped rows are the untouched originals.
    for (const d of dropped) expect(selections).toContain(d);
  });

  it("passes extra row fields through on kept rows", () => {
    const row = { blockId: "src-wd-open", day: "mon" as Day, autoAssigned: false, submissionId: 42 };
    const { kept } = carryOverSelections([row], sourceBlocks, targetBlocks);
    expect(kept).toEqual([{ blockId: "tgt-wd-open", day: "mon", autoAssigned: false, submissionId: 42 }]);
  });

  it("returns empty results for an empty selection", () => {
    expect(carryOverSelections([], sourceBlocks, targetBlocks)).toEqual({ kept: [], dropped: [] });
  });
});
