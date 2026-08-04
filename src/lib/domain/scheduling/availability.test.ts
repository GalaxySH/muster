import { describe, it, expect } from "vitest";
import { parseTime } from "../time";
import type { ShiftBlock } from "../types";
import { fillInSelection, fullAvailability } from "./availability";

function block(
  id: string,
  positionId: string,
  dayType: "weekday" | "weekend",
  start: string,
  end: string,
): ShiftBlock {
  return { id, positionId, dayType, start: parseTime(start), end: parseTime(end) };
}

const BLOCKS = [
  block("ca-am", "ca", "weekday", "8a", "12p"),
  block("ca-pm", "ca", "weekday", "12p", "4p"),
  block("ca-we", "ca", "weekend", "10a", "4p"),
  block("sl-am", "sl", "weekday", "8a", "12p"),
];

describe("fullAvailability", () => {
  it("expands weekday blocks over Mon-Fri and weekend blocks over Sat+Sun", () => {
    const cells = fullAvailability("ca", BLOCKS);

    expect(cells).toHaveLength(12); // two weekday blocks x 5 + one weekend block x 2
    expect(cells.filter((c) => c.blockId === "ca-am").map((c) => c.day)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
    ]);
    expect(
      cells
        .filter((c) => c.blockId === "ca-we")
        .map((c) => c.day)
        .sort(),
    ).toEqual(["sat", "sun"]);
  });

  it("ignores blocks belonging to other positions", () => {
    const cells = fullAvailability("ca", BLOCKS);
    expect(cells.some((c) => c.blockId === "sl-am")).toBe(false);
  });

  it("returns nothing for a position with no blocks", () => {
    expect(fullAvailability("barista", BLOCKS)).toEqual([]);
  });
});

describe("fillInSelection", () => {
  it("uses the answers a fill-in actually gave, never fabricating over them", () => {
    const drafted = [{ blockId: "ca-am", day: "mon" as const }];
    expect(fillInSelection("ca", BLOCKS, drafted)).toEqual(drafted);
  });

  it("falls back to full availability when they gave no answer at all", () => {
    expect(fillInSelection("ca", BLOCKS, undefined)).toHaveLength(12);
    expect(fillInSelection("ca", BLOCKS, [])).toHaveLength(12);
  });

  it("drops draft picks on removed shifts but keeps the live ones", () => {
    const cells = fillInSelection("ca", BLOCKS, [
      { blockId: "ca-am", day: "mon" },
      { blockId: "ca-retired", day: "tue" },
    ]);
    expect(cells).toEqual([{ blockId: "ca-am", day: "mon" }]);
  });

  it("falls back to full availability when every draft pick is on a removed shift", () => {
    // The regression this seam exists for: a stale draft that survives only as
    // dead cells used to read as "they told us something", leaving the student
    // schedulable nowhere and absent from every warning list.
    const cells = fillInSelection("ca", BLOCKS, [
      { blockId: "ca-retired", day: "mon" },
      { blockId: "ca-also-retired", day: "tue" },
    ]);
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.blockId !== "ca-retired")).toBe(true);
  });

  it("never offers a cell outside the live block set it was given", () => {
    const live = BLOCKS.filter((b) => b.id !== "ca-we");
    const cells = fillInSelection("ca", live, undefined);
    expect(cells.some((c) => c.blockId === "ca-we")).toBe(false);
  });
});
