import { describe, expect, it } from "vitest";
import { knownSelection, partitionSelection } from "./orphans";
import type { SelectedShift, ShiftBlock } from "./types";

const block = (id: string, start = 600, end = 900): ShiftBlock => ({
  id,
  positionId: "cashier",
  dayType: "weekday",
  start,
  end,
});

const cell = (blockId: string, day: SelectedShift["day"] = "mon"): SelectedShift => ({
  blockId,
  day,
});

describe("partitionSelection", () => {
  it("keeps every cell whose block is live", () => {
    const blocks = [block("a"), block("b")];
    const result = partitionSelection([cell("a"), cell("b", "tue")], blocks);
    expect(result.known).toEqual([cell("a"), cell("b", "tue")]);
    expect(result.orphaned).toEqual([]);
  });

  it("separates cells pointing at a block that is not in the live set", () => {
    const result = partitionSelection(
      [cell("a"), cell("gone"), cell("b")],
      [block("a"), block("b")],
    );
    expect(result.known).toEqual([cell("a"), cell("b")]);
    expect(result.orphaned).toEqual([cell("gone")]);
  });

  it("treats an empty block set as orphaning everything", () => {
    const selection = [cell("a"), cell("b")];
    const result = partitionSelection(selection, []);
    expect(result.known).toEqual([]);
    expect(result.orphaned).toEqual(selection);
  });

  it("splits per cell, not per block: same block on two days both follow the block", () => {
    const result = partitionSelection([cell("gone", "mon"), cell("gone", "tue")], [block("a")]);
    expect(result.orphaned).toHaveLength(2);
    expect(result.known).toEqual([]);
  });

  it("preserves extra fields on the caller's cell type", () => {
    const rows = [
      { blockId: "a", day: "mon" as const, autoAssigned: true },
      { blockId: "gone", day: "sat" as const, autoAssigned: false },
    ];
    const result = partitionSelection(rows, [block("a")]);
    expect(result.known[0]?.autoAssigned).toBe(true);
    expect(result.orphaned[0]?.autoAssigned).toBe(false);
  });

  it("returns an empty partition for an empty selection", () => {
    expect(partitionSelection([], [block("a")])).toEqual({ known: [], orphaned: [] });
  });

  it("knownSelection is the known half", () => {
    expect(knownSelection([cell("a"), cell("gone")], [block("a")])).toEqual([cell("a")]);
  });
});
