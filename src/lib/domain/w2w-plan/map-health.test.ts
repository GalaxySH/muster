import { describe, it, expect } from "vitest";
import { mapHealthIssues, type MapTarget, type PlanPosition } from "./map-health";
import type { W2wPositionMapEntry } from "./types";

function target(over: Partial<MapTarget> = {}): MapTarget {
  return {
    id: "stocker",
    name: "Stocker",
    active: true,
    mergedIntoId: null,
    mergedIntoName: null,
    liveBlockCount: 3,
    liveWeekendBlockCount: 1,
    ...over,
  };
}

function entry(over: Partial<W2wPositionMapEntry> = {}): W2wPositionMapEntry {
  return {
    w2wPositionId: "100",
    w2wPositionName: "GDEC - Stocker",
    musterPositionId: "stocker",
    fillOrder: 0,
    ...over,
  };
}

function planPosition(over: Partial<PlanPosition> = {}): PlanPosition {
  return {
    w2wPositionId: "100",
    w2wPositionName: "GDEC - Stocker",
    rowCount: 5,
    weekendRowCount: 0,
    ...over,
  };
}

const kinds = (issues: { kind: string }[]) => issues.map((i) => i.kind);

describe("mapHealthIssues", () => {
  it("reports nothing for a map whose targets are all healthy and used", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target()],
      planPositions: [planPosition()],
    });
    expect(issues).toEqual([]);
  });

  it("flags an empty map once a plan exists", () => {
    const issues = mapHealthIssues({ map: [], targets: [target()], planPositions: [] });
    expect(kinds(issues)).toEqual(["empty_map"]);
  });

  it("stays quiet about an empty map when no plan is imported", () => {
    // Nothing is being exported yet, so there is nothing to be wrong about.
    // Otherwise a box that has never used the round-trip carries a permanent
    // red alert for a feature it is not using.
    const issues = mapHealthIssues({ map: [], targets: [target()], planPositions: null });
    expect(issues).toEqual([]);
  });

  it("flags a plan position with no mapping", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target()],
      planPositions: [
        planPosition(),
        planPosition({ w2wPositionId: "999", w2wPositionName: "GDEC - Dock", rowCount: 2 }),
      ],
    });
    expect(kinds(issues)).toEqual(["unmapped_position"]);
    expect(issues[0]!.w2wPositionId).toBe("999");
    expect(issues[0]!.message).toContain("its 2 shifts a week");
  });

  it("credits rows to the entry that answered, even when only the name matched", () => {
    // W2W recreated the position under a new id. Matching falls back to the
    // name, so the mapping IS doing its job and must not be called unused:
    // acting on that advice would strip the names off all 5 shifts.
    const issues = mapHealthIssues({
      map: [entry({ w2wPositionId: "100" })],
      targets: [target()],
      planPositions: [planPosition({ w2wPositionId: "555", w2wPositionName: "GDEC - Stocker" })],
    });
    expect(issues).toEqual([]);
  });

  it("flags a mapping whose target position is gone", () => {
    const issues = mapHealthIssues({
      map: [entry({ musterPositionId: "ghost" })],
      targets: [target()],
      planPositions: [planPosition()],
    });
    expect(kinds(issues)).toEqual(["target_missing"]);
  });

  it("flags a mapping pointing at an alias, and names the position to move to", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target({ mergedIntoId: "cashier", mergedIntoName: "Cashier" })],
      planPositions: [planPosition()],
    });
    expect(kinds(issues)).toEqual(["target_alias"]);
    expect(issues[0]!.message).toContain("Point it at Cashier");
  });

  it("flags a mapping pointing at an inactive position", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target({ active: false })],
      planPositions: [planPosition()],
    });
    expect(kinds(issues)).toEqual(["target_inactive"]);
  });

  it("does not report both alias and inactive for the same mapping", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target({ active: false, mergedIntoId: "cashier", mergedIntoName: "Cashier" })],
      planPositions: [planPosition()],
    });
    expect(kinds(issues)).toEqual(["target_alias"]);
  });

  it("flags a target with no live blocks", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target({ liveBlockCount: 0, liveWeekendBlockCount: 0 })],
      planPositions: [planPosition()],
    });
    expect(kinds(issues)).toEqual(["target_no_blocks"]);
  });

  it("flags weekend plan rows mapped onto a weekday-only position", () => {
    // Mapping a W2W position that runs weekends onto e.g. Barista, which is
    // weekend exempt, leaves those rows matching nothing and shipping open.
    const issues = mapHealthIssues({
      map: [entry({ musterPositionId: "barista" })],
      targets: [target({ id: "barista", name: "Barista", liveWeekendBlockCount: 0 })],
      planPositions: [planPosition({ rowCount: 7, weekendRowCount: 2 })],
    });
    expect(kinds(issues)).toEqual(["target_no_weekend_blocks"]);
    expect(issues[0]!.message).toContain("2 weekend shifts");
  });

  it("stays quiet about weekends when the plan has no weekend rows for it", () => {
    const issues = mapHealthIssues({
      map: [entry({ musterPositionId: "barista" })],
      targets: [target({ id: "barista", name: "Barista", liveWeekendBlockCount: 0 })],
      planPositions: [planPosition({ weekendRowCount: 0 })],
    });
    expect(issues).toEqual([]);
  });

  it("flags a mapping the current plan never uses", () => {
    const issues = mapHealthIssues({
      map: [
        entry(),
        entry({ w2wPositionId: "101", w2wPositionName: "GDEC - Dock Stocker", fillOrder: 1 }),
      ],
      targets: [target()],
      planPositions: [planPosition()],
    });
    expect(kinds(issues)).toEqual(["unused_mapping"]);
    expect(issues[0]!.w2wPositionId).toBe("101");
  });

  it("skips plan-relative checks when no plan is imported", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target()],
      planPositions: null,
    });
    expect(issues).toEqual([]);
  });

  it("writes a whole sentence when there is no plan to count shifts from", () => {
    const issues = mapHealthIssues({
      map: [entry()],
      targets: [target({ active: false })],
      planPositions: null,
    });
    expect(issues[0]!.message).toContain("so its shifts export with no names");
    expect(issues[0]!.message).not.toContain("its  export");
  });

  it("flags two mappings sharing a position and a fill order", () => {
    const issues = mapHealthIssues({
      map: [entry(), entry({ w2wPositionId: "101", w2wPositionName: "GDEC - Dock Stocker" })],
      targets: [target()],
      planPositions: [
        planPosition(),
        planPosition({ w2wPositionId: "101", w2wPositionName: "GDEC - Dock Stocker" }),
      ],
    });
    expect(kinds(issues)).toEqual(["duplicate_fill_order"]);
    expect(issues[0]!.message).toContain("GDEC - Stocker and GDEC - Dock Stocker");
  });

  it("accepts two mappings sharing a position with distinct fill orders", () => {
    const issues = mapHealthIssues({
      map: [
        entry(),
        entry({ w2wPositionId: "101", w2wPositionName: "GDEC - Dock Stocker", fillOrder: 1 }),
      ],
      targets: [target()],
      planPositions: [
        planPosition(),
        planPosition({ w2wPositionId: "101", w2wPositionName: "GDEC - Dock Stocker" }),
      ],
    });
    expect(issues).toEqual([]);
  });

  it("puts dangers before warnings", () => {
    const issues = mapHealthIssues({
      map: [
        entry({ w2wPositionId: "101", w2wPositionName: "GDEC - Dock Stocker", fillOrder: 1 }),
        entry({ musterPositionId: "ghost" }),
      ],
      targets: [target()],
      planPositions: [planPosition({ w2wPositionId: "100" })],
    });
    expect(issues[0]!.severity).toBe("danger");
    expect(issues.at(-1)!.severity).toBe("warning");
  });
});
