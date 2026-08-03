import { describe, expect, it } from "vitest";
import { fillPlan, type ExportIdentity, type FillAssignment } from "./fill";
import type { W2wPlanRow, W2wPositionMapEntry } from "./types";
import type { Day } from "../types";

function row(over: Partial<W2wPlanRow> & { seq: number; day: Day }): W2wPlanRow {
  return {
    w2wPositionId: "100",
    w2wPositionName: "GDEC - CA",
    category: "",
    description: "",
    startTime: "08:00 AM",
    endTime: "11:00 AM",
    duration: "3.0",
    startMinutes: 480,
    endMinutes: 660,
    employeeName: "",
    employeeNumber: "",
    ...over,
  };
}

const MAP: W2wPositionMapEntry[] = [
  { w2wPositionId: "100", w2wPositionName: "GDEC - CA", musterPositionId: "ca", fillOrder: 0 },
  { w2wPositionId: "200", w2wPositionName: "GDEC - Stocker", musterPositionId: "stocker", fillOrder: 0 },
  { w2wPositionId: "201", w2wPositionName: "GDEC - Dock Stocker", musterPositionId: "stocker", fillOrder: 1 },
];

const ids = (emails: string[], derived = false): Map<string, ExportIdentity> =>
  new Map(emails.map((e) => [e, { name: `Name ${e}`, employeeNumber: "", derived }]));

const assign = (studentEmail: string, blockId: string, day: Day, cohort: FillAssignment["cohort"]): FillAssignment => ({
  studentEmail,
  blockId,
  day,
  cohort,
});

describe("fillPlan", () => {
  it("zips students onto seats by email order and keeps row count", () => {
    const rows = [row({ seq: 0, day: "mon" }), row({ seq: 1, day: "mon" })];
    const res = fillPlan(
      rows,
      ["blk", "blk"],
      [assign("zoe@x.edu", "blk", "mon", "weekday"), assign("amy@x.edu", "blk", "mon", "weekday")],
      ids(["amy@x.edu", "zoe@x.edu"]),
      MAP,
      "a",
    );
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]!.filledEmail).toBe("amy@x.edu");
    expect(res.rows[1]!.filledEmail).toBe("zoe@x.edu");
    expect(res.overflow).toEqual([]);
  });

  it("staffs weekend rows from the week's cohorts plus every-weekend", () => {
    const rows = [row({ seq: 0, day: "sat" }), row({ seq: 1, day: "sat" })];
    const assignments = [
      assign("a-cohort@x.edu", "blk", "sat", "a"),
      assign("b-cohort@x.edu", "blk", "sat", "b"),
      assign("every@x.edu", "blk", "sat", "every"),
    ];
    const all = ids(["a-cohort@x.edu", "b-cohort@x.edu", "every@x.edu"]);
    const weekA = fillPlan(rows, ["blk", "blk"], assignments, all, MAP, "a");
    const weekB = fillPlan(rows, ["blk", "blk"], assignments, all, MAP, "b");
    expect(weekA.rows.map((r) => r.filledEmail)).toEqual(["a-cohort@x.edu", "every@x.edu"]);
    expect(weekB.rows.map((r) => r.filledEmail)).toEqual(["b-cohort@x.edu", "every@x.edu"]);
  });

  it("names overflow students instead of inventing seats", () => {
    const rows = [row({ seq: 0, day: "mon" })];
    const res = fillPlan(
      rows,
      ["blk"],
      [assign("amy@x.edu", "blk", "mon", "weekday"), assign("zoe@x.edu", "blk", "mon", "weekday")],
      ids(["amy@x.edu", "zoe@x.edu"]),
      MAP,
      "a",
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.filledEmail).toBe("amy@x.edu");
    expect(res.overflow).toEqual([{ studentEmail: "zoe@x.edu", blockId: "blk", day: "mon" }]);
  });

  it("assignments on a block with no plan seats become overflow", () => {
    const rows = [row({ seq: 0, day: "mon" })];
    const res = fillPlan(
      rows,
      ["blk"],
      [assign("amy@x.edu", "other-blk", "mon", "weekday")],
      ids(["amy@x.edu"]),
      MAP,
      "a",
    );
    expect(res.rows[0]!.filledEmail).toBeNull();
    expect(res.overflow).toEqual([{ studentEmail: "amy@x.edu", blockId: "other-blk", day: "mon" }]);
  });

  it("fills plain stocker seats before dock seats sharing the block", () => {
    const rows = [
      row({ seq: 0, day: "mon", w2wPositionId: "201", w2wPositionName: "GDEC - Dock Stocker" }),
      row({ seq: 1, day: "mon", w2wPositionId: "200", w2wPositionName: "GDEC - Stocker" }),
    ];
    const res = fillPlan(
      rows,
      ["blk", "blk"],
      [assign("amy@x.edu", "blk", "mon", "weekday")],
      ids(["amy@x.edu"]),
      MAP,
      "a",
    );
    // The single student lands on the plain Stocker row despite dock coming first in the file.
    expect(res.rows[1]!.filledEmail).toBe("amy@x.edu");
    expect(res.rows[0]!.filledEmail).toBeNull();
  });

  it("leaves unmatched rows open and reports derived-name fills", () => {
    const rows = [row({ seq: 0, day: "mon" }), row({ seq: 1, day: "mon" })];
    const res = fillPlan(
      rows,
      [null, "blk"],
      [assign("amy@x.edu", "blk", "mon", "weekday")],
      ids(["amy@x.edu"], true),
      MAP,
      "a",
    );
    expect(res.rows[0]!.filledEmail).toBeNull();
    expect(res.rows[1]!.filledEmail).toBe("amy@x.edu");
    expect(res.fallbackEmails).toEqual(["amy@x.edu"]);
  });

  it("throws when an assigned student has no export identity", () => {
    const rows = [row({ seq: 0, day: "mon" })];
    expect(() =>
      fillPlan(rows, ["blk"], [assign("amy@x.edu", "blk", "mon", "weekday")], new Map(), MAP, "a"),
    ).toThrow(/identity/);
  });
});
