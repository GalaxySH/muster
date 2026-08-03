import { describe, it, expect } from "vitest";
import { parseTime } from "../time";
import type { ShiftBlock } from "../types";
import { fullAvailability } from "./availability";

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
