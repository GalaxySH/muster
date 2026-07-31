import { describe, expect, it } from "vitest";
import { buildScheduleMatrix, SCHEDULE_EXPORT_HEADERS, type ScheduleExportRow } from "./export";

const student = (over: Partial<ScheduleExportRow> = {}): ScheduleExportRow => ({
  displayName: "Ada Lovelace",
  email: "ada@wisc.edu",
  positionName: "Cashier",
  scheduled: false,
  cells: [],
  ...over,
});

describe("buildScheduleMatrix", () => {
  it("emits only the header row when no one holds an assignment", () => {
    expect(buildScheduleMatrix([student()])).toEqual([[...SCHEDULE_EXPORT_HEADERS]]);
  });

  it("emits one row per assigned cell with day, span, and rotation labels", () => {
    const rows = buildScheduleMatrix([
      student({
        scheduled: true,
        cells: [
          { day: "mon", start: 14 * 60, end: 17 * 60, cohort: "weekday" },
          { day: "sat", start: 10 * 60, end: 14 * 60, cohort: "b" },
        ],
      }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      "Ada Lovelace",
      "ada@wisc.edu",
      "Cashier",
      "Mon",
      "2p to 5p",
      "",
      "yes",
    ]);
    expect(rows[2]?.[3]).toBe("Sat");
    expect(rows[2]?.[5]).toBe("B");
  });

  it("labels every-weekend cells and blanks a missing position", () => {
    const rows = buildScheduleMatrix([
      student({
        positionName: null,
        cells: [{ day: "sun", start: 8 * 60, end: 12 * 60, cohort: "every" }],
      }),
    ]);
    expect(rows[1]?.[2]).toBe("");
    expect(rows[1]?.[5]).toBe("Every weekend");
  });
});
