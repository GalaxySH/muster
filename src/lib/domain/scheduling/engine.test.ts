import { describe, it, expect } from "vitest";
import { parseTime } from "../time";
import { computeCapacity } from "../capacity";
import type { Position, SelectedShift, ShiftBlock } from "../types";
import { DAY_CAP_MINUTES, generateAssignments, targetMinutes } from "./engine";
import { DEFAULT_SCHEDULING_PARAMS } from "./params";
import { orderHash } from "./seats";
import type { EngineInput, ScheduleAssignment, ScheduleStudent } from "./types";

const CA: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};
const SL: Position = {
  id: "sl",
  name: "Shift Lead",
  minHours: 15,
  minDays: 3,
  weekendExempt: false,
};
const BAR: Position = {
  id: "barista",
  name: "Barista",
  minHours: 10,
  minDays: 2,
  weekendExempt: true,
};
const POSITIONS = [CA, SL, BAR];

function block(
  id: string,
  positionId: string,
  dayType: "weekday" | "weekend",
  start: string,
  end: string,
  desiredCapacity: number | null = null,
): ShiftBlock {
  return { id, positionId, dayType, start: parseTime(start), end: parseTime(end), desiredCapacity };
}

const sel = (blockId: string, day: SelectedShift["day"]): SelectedShift => ({ blockId, day });

/** Deterministic FCFS stamps: minute n of the response window. */
const at = (n: number) => new Date(Date.UTC(2026, 7, 1, 10, n));

function student(email: string, over: Partial<ScheduleStudent> = {}): ScheduleStudent {
  return {
    email,
    positionId: "ca",
    international: false,
    everyWeekendOptIn: false,
    desiredHours: 10,
    submittedAt: at(0),
    scheduled: false,
    selection: [],
    ...over,
  };
}

function run(
  students: ScheduleStudent[],
  blocks: ShiftBlock[],
  previous: ScheduleAssignment[] = [],
  deferredBlockIds?: readonly string[],
  previousFillIns?: readonly string[],
): ReturnType<typeof generateAssignments> {
  const input: EngineInput = {
    students,
    positions: POSITIONS,
    blocks,
    previous,
    deferredBlockIds,
    previousFillIns,
  };
  return generateAssignments(input);
}

const rowsOf = (result: ReturnType<typeof generateAssignments>, email: string) =>
  result.assignments.filter((a) => a.studentEmail === email);

const reportOf = (result: ReturnType<typeof generateAssignments>, email: string) =>
  result.report.students.find((s) => s.email === email)!;

/** Merged assigned minutes per day for one student, to check the daily cap. */
function dayLoads(rows: ScheduleAssignment[], blocks: ShiftBlock[]): Map<string, number> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const loads = new Map<string, number>();
  const perDay = new Map<string, { start: number; end: number }[]>();
  for (const r of rows) {
    const b = byId.get(r.blockId)!;
    const list = perDay.get(r.day) ?? [];
    list.push({ start: b.start, end: b.end });
    perDay.set(r.day, list);
  }
  for (const [day, ranges] of perDay) {
    ranges.sort((a, b) => a.start - b.start);
    let total = 0;
    let cur = { ...ranges[0]! };
    for (const r of ranges.slice(1)) {
      if (r.start <= cur.end) cur.end = Math.max(cur.end, r.end);
      else {
        total += cur.end - cur.start;
        cur = { ...r };
      }
    }
    total += cur.end - cur.start;
    loads.set(day, total);
  }
  return loads;
}

// Barista weekday grid: two adjacent 4h blocks per day, so a full day is 8h.
const barGrid = [
  block("bar-am", "barista", "weekday", "8a", "12p"),
  block("bar-pm", "barista", "weekday", "12p", "4p"),
];
const barSelection = (["mon", "tue", "wed", "thu", "fri"] as const).flatMap((d) => [
  sel("bar-am", d),
  sel("bar-pm", d),
]);

describe("targetMinutes", () => {
  it("uses desired hours between floor and cap", () => {
    expect(targetMinutes(student("s@w", { desiredHours: 12 }), CA)).toBe(720);
  });
  it("raises a too-low desire to the position floor", () => {
    expect(targetMinutes(student("s@w", { desiredHours: 5 }), CA)).toBe(600);
  });
  it("falls back to the floor when desired hours are missing", () => {
    expect(targetMinutes(student("s@w", { desiredHours: null }), SL)).toBe(900);
  });
  it("caps at 30h domestic and 20h international", () => {
    expect(targetMinutes(student("s@w", { desiredHours: 40 }), CA)).toBe(1800);
    expect(targetMinutes(student("s@w", { desiredHours: 40, international: true }), CA)).toBe(1200);
  });
});

describe("generateAssignments", () => {
  it("is deterministic: the same input twice gives identical output", () => {
    const students = [
      student("b@w", { positionId: "barista", selection: barSelection, submittedAt: at(1) }),
      student("a@w", { positionId: "barista", selection: barSelection, submittedAt: at(2) }),
    ];
    const first = run(students, barGrid);
    const second = run(students, barGrid);
    expect(second).toEqual(first);
  });

  it("concentrates a 10h target onto the minimum two days", () => {
    const r = run(
      [student("b@w", { positionId: "barista", desiredHours: 10, selection: barSelection })],
      barGrid,
    );
    const report = reportOf(r, "b@w");
    expect(report.daysUsed).toBe(2);
    expect(report.assignedMinutes).toBeGreaterThanOrEqual(600);
    for (const load of dayLoads(rowsOf(r, "b@w"), barGrid).values()) {
      expect(load).toBeLessThanOrEqual(DAY_CAP_MINUTES);
    }
  });

  it("opens a third day only when 8h days cannot hold the target", () => {
    const r = run(
      [student("b@w", { positionId: "barista", desiredHours: 20, selection: barSelection })],
      barGrid,
    );
    const report = reportOf(r, "b@w");
    expect(report.daysUsed).toBe(3);
    expect(report.assignedMinutes).toBeGreaterThanOrEqual(1200);
    for (const load of dayLoads(rowsOf(r, "b@w"), barGrid).values()) {
      expect(load).toBeLessThanOrEqual(DAY_CAP_MINUTES);
    }
  });

  it("seeds a Shift Lead's three-day floor even when two days would reach the hours", () => {
    const blocks = [
      block("sl-mon", "sl", "weekday", "10a", "6p"),
      block("sl-tue", "sl", "weekday", "10a", "6p"),
      block("sl-wed", "sl", "weekday", "2p", "6p"),
    ];
    const r = run(
      [
        student("lead@w", {
          positionId: "sl",
          desiredHours: 15,
          selection: [sel("sl-mon", "mon"), sel("sl-tue", "tue"), sel("sl-wed", "wed")],
        }),
      ],
      blocks,
    );
    expect(reportOf(r, "lead@w").daysUsed).toBe(3);
  });

  it("refuses a single block longer than 8h even alone on its day", () => {
    const blocks = [
      block("long", "barista", "weekday", "8a", "5p"), // 9h
      ...barGrid,
    ];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 10,
          selection: [sel("long", "mon"), sel("bar-am", "mon"), sel("bar-pm", "tue")],
        }),
      ],
      blocks,
    );
    const loads = dayLoads(rowsOf(r, "b@w"), blocks);
    expect(loads.get("mon")).toBe(240); // day-hours: a 9h block breaks the hard 8h day cap even standing alone
    const ids = rowsOf(r, "b@w")
      .map((a) => `${a.blockId}|${a.day}`)
      .sort();
    expect(ids).toEqual(["bar-am|mon", "bar-pm|tue"]); // day-hours: the long block is never assigned
  });

  it("gives a contested last seat to the earlier responder", () => {
    const blocks = [block("scarce", "barista", "weekday", "12p", "4p", 1), ...barGrid];
    const selection = [sel("scarce", "mon"), ...barSelection];
    const r = run(
      [
        student("late@w", { positionId: "barista", selection, submittedAt: at(9) }),
        student("early@w", { positionId: "barista", selection, submittedAt: at(3) }),
      ],
      blocks,
    );
    const holders = r.assignments.filter((a) => a.blockId === "scarce").map((a) => a.studentEmail);
    expect(holders).toEqual(["early@w"]);
  });

  it("prefers later-ending cells, then scarcer ones", () => {
    const blocks = [
      block("morning", "barista", "weekday", "8a", "12p"),
      block("night", "barista", "weekday", "5p", "9p"),
      block("targeted", "barista", "weekday", "12p", "4p", 5),
      block("untargeted", "barista", "weekday", "12p", "4p"),
    ];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 10,
          selection: [
            sel("morning", "mon"),
            sel("night", "mon"),
            sel("targeted", "tue"),
            sel("untargeted", "tue"),
          ],
        }),
      ],
      blocks,
    );
    const ids = rowsOf(r, "b@w").map((a) => a.blockId);
    expect(ids).toContain("night");
    expect(ids).toContain("targeted");
    expect(ids).not.toContain("untargeted");
  });

  it("assigns a staggered pair as a double when neither block contains the other", () => {
    const blocks = [
      block("first", "barista", "weekday", "12p", "4p"),
      block("stagger", "barista", "weekday", "3:45p", "7:45p"),
      ...barGrid,
    ];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 10,
          selection: [sel("first", "mon"), sel("stagger", "mon"), sel("bar-am", "tue")],
        }),
      ],
      blocks,
    );
    const monIds = rowsOf(r, "b@w")
      .filter((a) => a.day === "mon")
      .map((a) => a.blockId)
      .sort();
    expect(monIds).toEqual(["first", "stagger"]);
    // The 15-minute handoff overlap is counted once: 12p to 7:45p is 7.75h.
    expect(dayLoads(rowsOf(r, "b@w"), blocks).get("mon")).toBe(465);
  });

  it("still refuses stacking a block inside another on the same day", () => {
    const blocks = [
      block("long", "barista", "weekday", "12p", "8p"),
      block("inner", "barista", "weekday", "2p", "6p"),
      ...barGrid,
    ];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 20,
          selection: [sel("long", "mon"), sel("inner", "mon"), sel("bar-am", "tue")],
        }),
      ],
      blocks,
    );
    // The contained block adds no covered time (the day cap alone would not
    // refuse it), so Monday keeps only the long block.
    const monIds = rowsOf(r, "b@w")
      .filter((a) => a.day === "mon")
      .map((a) => a.blockId);
    expect(monIds).toEqual(["long"]);
  });

  it("refuses a staggered double whose merged span exceeds the day cap", () => {
    const blocks = [
      block("first", "barista", "weekday", "11a", "4p"),
      block("stagger", "barista", "weekday", "3:45p", "8:45p"),
      ...barGrid,
    ];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 20,
          selection: [sel("first", "mon"), sel("stagger", "mon"), sel("bar-am", "tue")],
        }),
      ],
      blocks,
    );
    // Neither contains the other, but the merged 11a-8:45p span is 9.75h,
    // past the 8h cap, so only one of the pair lands on Monday.
    const monIds = rowsOf(r, "b@w")
      .filter((a) => a.day === "mon")
      .map((a) => a.blockId);
    expect(monIds).toEqual(["stagger"]);
    for (const load of dayLoads(rowsOf(r, "b@w"), blocks).values()) {
      expect(load).toBeLessThanOrEqual(DAY_CAP_MINUTES);
    }
  });

  it("refuses a cell that would leave another shift covering nothing unique", () => {
    const blocks = [
      block("a-first", "barista", "weekday", "12p", "3p"),
      block("b-late", "barista", "weekday", "2:45p", "6p"),
      block("c-mid", "barista", "weekday", "1p", "5p"),
      ...barGrid,
    ];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 20,
          selection: [
            sel("a-first", "mon"),
            sel("b-late", "mon"),
            sel("c-mid", "mon"),
            sel("bar-am", "tue"),
          ],
        }),
      ],
      blocks,
    );
    // b-late and c-mid form a legal double, but adding a-first would leave
    // c-mid covered by the union of the other two, so a-first stays off
    // Monday even though no single pair of these blocks nests.
    const monIds = rowsOf(r, "b@w")
      .filter((a) => a.day === "mon")
      .map((a) => a.blockId)
      .sort();
    expect(monIds).toEqual(["b-late", "c-mid"]);
  });

  it("takes only one of several disjoint same-day blocks (no split shifts)", () => {
    const blocks = [
      block("early", "barista", "weekday", "8a", "10a"),
      block("mid", "barista", "weekday", "12p", "2p"),
      block("late", "barista", "weekday", "4p", "6p"),
      ...barGrid,
    ];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 10,
          selection: [
            sel("early", "mon"),
            sel("mid", "mon"),
            sel("late", "mon"),
            sel("bar-am", "tue"),
          ],
        }),
      ],
      blocks,
    );
    const monIds = rowsOf(r, "b@w")
      .filter((a) => a.day === "mon")
      .map((a) => a.blockId)
      .sort();
    expect(monIds).toEqual(["late"]); // split-shift: a second disjoint block would split the day (this case used to stack all three)
  });

  it("assigns only cells the student selected", () => {
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          selection: [sel("bar-am", "mon"), sel("bar-pm", "mon"), sel("bar-am", "tue")],
        }),
      ],
      barGrid,
    );
    const offered = new Set(["bar-am|mon", "bar-pm|mon", "bar-am|tue"]);
    for (const a of rowsOf(r, "b@w")) {
      expect(offered.has(`${a.blockId}|${a.day}`)).toBe(true);
    }
  });

  it("seeds every non-exempt student a weekend cell and balances cohorts by load", () => {
    const blocks = [
      block("wd", "ca", "weekday", "8a", "4p"),
      block("wd2", "ca", "weekday", "8a", "4p"),
      block("we", "ca", "weekend", "11a", "7p"),
    ];
    const selection = [sel("wd", "mon"), sel("wd", "tue"), sel("wd2", "wed"), sel("we", "sat")];
    const r = run(
      [
        student("one@w", { selection, submittedAt: at(1) }),
        student("two@w", { selection, submittedAt: at(2) }),
      ],
      blocks,
    );
    const cohortOf = (email: string) => rowsOf(r, email).find((a) => a.day === "sat")!.cohort;
    expect(cohortOf("one@w")).toBe("a");
    expect(cohortOf("two@w")).toBe("b");
    expect(reportOf(r, "one@w").cohort).toBe("a");
  });

  it("balances weekend cohorts on merged spans, not raw block sums", () => {
    const blocks = [
      block("we-early", "ca", "weekend", "11a", "3p"),
      block("we-late", "ca", "weekend", "2:45p", "7p"),
      block("we-full", "ca", "weekend", "11a", "7p"),
      block("wd", "ca", "weekday", "8a", "4p"),
    ];
    // Cohort a holds a staggered double (raw sum 495, merged 480); cohort b
    // holds a single 480-minute block. True loads are equal.
    const previous: ScheduleAssignment[] = [
      { studentEmail: "double@w", blockId: "we-early", day: "sat", cohort: "a" },
      { studentEmail: "double@w", blockId: "we-late", day: "sat", cohort: "a" },
      { studentEmail: "single@w", blockId: "we-full", day: "sat", cohort: "b" },
    ];
    const r = run(
      [
        student("double@w", { scheduled: true, selection: [], submittedAt: at(1) }),
        student("single@w", { scheduled: true, selection: [], submittedAt: at(2) }),
        student("new@w", {
          selection: [sel("we-full", "sun"), sel("wd", "mon"), sel("wd", "tue")],
          submittedAt: at(3),
        }),
      ],
      blocks,
      previous,
    );
    // The double's 15-minute handoff overlap counts once, so the loads tie
    // and the tie goes to cohort a; raw sums would have steered to b.
    expect(rowsOf(r, "new@w").find((a) => a.day === "sun")!.cohort).toBe("a");
  });

  it("counts an every-weekend opt-in against both rotation weeks", () => {
    const blocks = [
      block("wd", "ca", "weekday", "8a", "4p"),
      block("we", "ca", "weekend", "11a", "7p", 1),
    ];
    const selection = [sel("wd", "mon"), sel("wd", "tue"), sel("we", "sat")];
    const r = run(
      [
        student("opt@w", { selection, everyWeekendOptIn: true, submittedAt: at(1) }),
        student("next@w", { selection, submittedAt: at(2) }),
      ],
      blocks,
    );
    expect(rowsOf(r, "opt@w").find((a) => a.day === "sat")!.cohort).toBe("every");
    // The single weekend seat is spent in both weeks, so nobody else fits.
    expect(rowsOf(r, "next@w").filter((a) => a.day === "sat")).toHaveLength(0);
  });

  it("matches computeCapacity's averaging math for assigned hours", () => {
    const blocks = [
      block("wd", "ca", "weekday", "8a", "4p"),
      block("wd2", "ca", "weekday", "4p", "8p"),
      block("we", "ca", "weekend", "11a", "7p"),
    ];
    const r = run(
      [
        student("s@w", {
          desiredHours: 14,
          selection: [sel("wd", "mon"), sel("wd2", "tue"), sel("we", "sat"), sel("we", "sun")],
        }),
      ],
      blocks,
    );
    const rows = rowsOf(r, "s@w");
    const asSelection = rows.map((a) => ({ blockId: a.blockId, day: a.day }));
    const capacity = computeCapacity(asSelection, blocks, { everyWeekendOptIn: false });
    expect(reportOf(r, "s@w").assignedMinutes).toBeCloseTo(capacity.weeklyAverageMinutes, 6);
  });

  it("carries a scheduled student's previous rows verbatim and holds their seats", () => {
    const blocks = [
      block("scarce", "ca", "weekend", "11a", "7p", 1),
      block("wd", "ca", "weekday", "8a", "4p"),
    ];
    const previous: ScheduleAssignment[] = [
      { studentEmail: "frozen@w", blockId: "scarce", day: "sat", cohort: "a" },
      { studentEmail: "frozen@w", blockId: "wd", day: "mon", cohort: "weekday" },
    ];
    const selection = [sel("scarce", "sat"), sel("wd", "mon"), sel("wd", "tue")];
    const r = run(
      [
        student("frozen@w", { selection, scheduled: true, submittedAt: at(9) }),
        student("rival@w", { selection, submittedAt: at(1) }),
      ],
      blocks,
      previous,
    );
    const byBlock = (a: ScheduleAssignment, b: ScheduleAssignment) =>
      a.blockId < b.blockId ? -1 : 1;
    expect([...rowsOf(r, "frozen@w")].sort(byBlock)).toEqual([...previous].sort(byBlock));
    expect(reportOf(r, "frozen@w").frozen).toBe(true);
    // The frozen seat wins even against an earlier responder in cohort a.
    const rivalSat = rowsOf(r, "rival@w").find((a) => a.day === "sat");
    expect(rivalSat?.cohort).toBe("b");
  });

  it("generates nothing new for a scheduled student without previous rows", () => {
    const r = run(
      [student("frozen@w", { positionId: "barista", selection: barSelection, scheduled: true })],
      barGrid,
    );
    expect(rowsOf(r, "frozen@w")).toHaveLength(0);
    expect(reportOf(r, "frozen@w").frozen).toBe(true);
  });

  it("drops previous rows of students no longer eligible and reports them", () => {
    const previous: ScheduleAssignment[] = [
      { studentEmail: "gone@w", blockId: "bar-am", day: "mon", cohort: "weekday" },
    ];
    const r = run(
      [student("b@w", { positionId: "barista", selection: barSelection })],
      barGrid,
      previous,
    );
    expect(rowsOf(r, "gone@w")).toHaveLength(0);
    expect(r.report.droppedStudents).toEqual(["gone@w"]);
  });

  it("drops a carried row whose block no longer exists and counts it", () => {
    const previous: ScheduleAssignment[] = [
      { studentEmail: "frozen@w", blockId: "deleted-block", day: "mon", cohort: "weekday" },
      { studentEmail: "frozen@w", blockId: "bar-am", day: "tue", cohort: "weekday" },
    ];
    const r = run(
      [student("frozen@w", { positionId: "barista", selection: [], scheduled: true })],
      barGrid,
      previous,
    );
    expect(rowsOf(r, "frozen@w").map((a) => a.blockId)).toEqual(["bar-am"]);
    expect(r.report.droppedBlockGone).toBe(1);
  });

  it("skips and reports students without a known position", () => {
    const r = run([student("lost@w", { positionId: null })], barGrid);
    expect(r.assignments).toHaveLength(0);
    expect(r.report.skippedNoPosition).toEqual(["lost@w"]);
  });

  describe("fill-in students", () => {
    // Contended grid: every cell is targeted, so seats are scarce and the
    // improvement pass has something to chase.
    const blocks = [
      block("am", "ca", "weekday", "8a", "12p", 2),
      block("pm", "ca", "weekday", "12p", "5p", 2),
      block("we", "ca", "weekend", "10a", "6p", 2),
      block("we-late", "ca", "weekend", "3p", "11p", 2),
    ];
    const everywhere = [
      ...(["mon", "tue", "wed", "thu", "fri"] as const).flatMap((d) => [
        sel("am", d),
        sel("pm", d),
      ]),
      ...(["sat", "sun"] as const).flatMap((d) => [sel("we", d), sel("we-late", d)]),
    ];
    const responders = () =>
      [1, 2, 3, 4].map((n) =>
        student(`r${n}@w`, { desiredHours: 16, selection: everywhere, submittedAt: at(n) }),
      );
    const fillIns = () =>
      [1, 2, 3].map((n) =>
        student(`f${n}@w`, {
          desiredHours: null,
          submittedAt: null,
          fillIn: true,
          selection: everywhere,
        }),
      );

    const rowKeys = (r: ReturnType<typeof generateAssignments>, email: string) =>
      rowsOf(r, email)
        .map((a) => `${a.blockId}|${a.day}|${a.cohort}`)
        .sort();

    it("leaves every other student's schedule untouched", () => {
      const without = run(responders(), blocks);
      const with_ = run([...responders(), ...fillIns()], blocks);
      for (const n of [1, 2, 3, 4]) {
        expect(rowKeys(with_, `r${n}@w`)).toEqual(rowKeys(without, `r${n}@w`));
      }
    });

    it("takes only the seats the others left over", () => {
      const r = run([...responders(), ...fillIns()], blocks);
      const seats = new Map<string, number>();
      for (const a of r.assignments) {
        const key = `${a.blockId}|${a.day}|${a.cohort}`;
        seats.set(key, (seats.get(key) ?? 0) + 1);
      }
      // Nothing may exceed its target of 2 per rotation week.
      for (const count of seats.values()) expect(count).toBeLessThanOrEqual(2);
      // With capacity genuinely left over, fill-ins do get work.
      expect(r.assignments.some((a) => a.studentEmail.startsWith("f"))).toBe(true);
    });

    it("reports a fill-in like any other student", () => {
      const r = run([...responders(), ...fillIns()], blocks);
      const report = reportOf(r, "f1@w");
      expect(report.frozen).toBe(false);
      // Null desired hours aims a fill-in at their position's floor.
      expect(report.targetMinutes).toBe(CA.minHours * 60);
    });

    it("marks fill-ins in the report so the next run can recognise them", () => {
      const r = run([...responders(), ...fillIns()], blocks);
      expect(reportOf(r, "f1@w").fillIn).toBe(true);
      expect(reportOf(r, "r1@w").fillIn).toBe(false);
    });

    it("does not call a dropped fill-in a departure when the option is switched off", () => {
      const previous: ScheduleAssignment[] = [
        { studentEmail: "f1@w", blockId: "am", day: "mon", cohort: "weekday" },
        { studentEmail: "gone@w", blockId: "am", day: "tue", cohort: "weekday" },
      ];
      // Second run: the option is off, so no fill-ins are supplied at all.
      const r = run(responders(), blocks, previous, undefined, ["f1@w"]);
      expect(rowsOf(r, "f1@w")).toHaveLength(0);
      // Only the student who really went away is reported as dropped.
      expect(r.report.droppedStudents).toEqual(["gone@w"]);
    });

    it("leaves a fill-in that found no room out of the run entirely", () => {
      // One seat, already taken by the responder, so the fill-in gets nothing.
      const tight = [block("only", "ca", "weekday", "8a", "4p", 1)];
      const selection = [sel("only", "mon")];
      const r = run(
        [
          student("r@w", { positionId: "barista", selection, submittedAt: at(1) }),
          student("f@w", { positionId: "barista", selection, fillIn: true, submittedAt: null }),
        ],
        tight,
      );
      expect(rowsOf(r, "f@w")).toHaveLength(0);
      expect(r.report.students.some((s) => s.email === "f@w")).toBe(false);
      // The empty fill-in must not inflate the run's problem counts.
      expect(r.report.shortOfTarget).toBe(1);
    });
  });

  describe("deferred cells (Shift Lead weekend closes)", () => {
    // A Shift Lead week with two weekend options: a daytime block and the
    // close. The close ends latest, so its night tier bonus normally wins.
    const slBlocks = [
      block("sl-wd", "sl", "weekday", "10a", "6p"),
      block("sl-we-day", "sl", "weekend", "10a", "6p"),
      block("sl-we-close", "sl", "weekend", "6p", "11:30p"),
    ];
    const slSelection = [
      sel("sl-wd", "mon"),
      sel("sl-wd", "tue"),
      sel("sl-wd", "wed"),
      sel("sl-we-day", "sat"),
      sel("sl-we-close", "sat"),
    ];
    const lead = (over: Partial<ScheduleStudent> = {}) =>
      student("sl@w", { positionId: "sl", desiredHours: 15, selection: slSelection, ...over });

    const weekendBlocksOf = (r: ReturnType<typeof generateAssignments>) =>
      rowsOf(r, "sl@w")
        .filter((a) => a.day === "sat")
        .map((a) => a.blockId);

    it("anchors the weekend on a non-deferred cell instead of the close", () => {
      // Control: without the bias the later-ending close wins the weekend seed.
      expect(weekendBlocksOf(run([lead()], slBlocks))).toContain("sl-we-close");

      const biased = run([lead()], slBlocks, [], ["sl-we-close"]);
      expect(weekendBlocksOf(biased)).toContain("sl-we-day");
      expect(weekendBlocksOf(biased)).not.toContain("sl-we-close");
    });

    it("opens a new day rather than taking a deferred cell on an open one", () => {
      // The close shares Saturday with a cell the lead already holds, so it is
      // the only candidate on an already-open day, while wed and thu sit free.
      // Preferring open days must not outrank the deferred tier.
      const blocks = [
        block("wd-late", "sl", "weekday", "5p", "10p"),
        block("we-late", "sl", "weekend", "5p", "10p"),
        block("we-close", "sl", "weekend", "6p", "11:30p"),
      ];
      const r = run(
        [
          student("lead@w", {
            positionId: "sl",
            desiredHours: 20,
            selection: [
              sel("wd-late", "mon"),
              sel("wd-late", "tue"),
              sel("wd-late", "wed"),
              sel("wd-late", "thu"),
              sel("we-late", "sat"),
              sel("we-close", "sat"),
            ],
          }),
        ],
        blocks,
        [],
        ["we-close"],
      );
      expect(rowsOf(r, "lead@w").map((a) => a.blockId)).not.toContain("we-close");
    });

    it("still uses the close when it is the only weekend cell offered", () => {
      const closeOnly = [
        sel("sl-wd", "mon"),
        sel("sl-wd", "tue"),
        sel("sl-wd", "wed"),
        sel("sl-we-close", "sat"),
      ];
      const r = run([lead({ selection: closeOnly })], slBlocks, [], ["sl-we-close"]);
      // Last resort: the weekend rule still has to be met (PLAN §5 #5).
      expect(weekendBlocksOf(r)).toEqual(["sl-we-close"]);
    });

    it("keeps a deferred cell empty even when it is the neediest target", () => {
      // Targeted and latest-ending, so it out-pulls everything in both the
      // placement pass and the improvement pass unless it is deferred.
      const targeted = [
        block("sl-wd", "sl", "weekday", "10a", "6p"),
        block("sl-we-day", "sl", "weekend", "10a", "6p", 5),
        block("sl-we-close", "sl", "weekend", "6p", "11:30p", 5),
      ];
      const r = run([lead()], targeted, [], ["sl-we-close"]);
      expect(rowsOf(r, "sl@w").some((a) => a.blockId === "sl-we-close")).toBe(false);
    });

    it("leaves other positions' closing blocks alone", () => {
      const blocks = [
        block("ca-wd", "ca", "weekday", "8a", "4p"),
        block("ca-we-day", "ca", "weekend", "10a", "4p"),
        block("ca-we-close", "ca", "weekend", "4p", "11:30p"),
      ];
      const r = run(
        [
          student("ca@w", {
            selection: [
              sel("ca-wd", "mon"),
              sel("ca-wd", "tue"),
              sel("ca-we-day", "sat"),
              sel("ca-we-close", "sat"),
            ],
          }),
        ],
        blocks,
        [],
        ["sl-we-close"],
      );
      const sat = rowsOf(r, "ca@w").filter((a) => a.day === "sat");
      expect(sat.map((a) => a.blockId)).toContain("ca-we-close");
    });
  });

  it("balances night priority against morning need instead of filling nights first", () => {
    const blocks = [
      block("night", "barista", "weekday", "5p", "9p", 4),
      block("morning", "barista", "weekday", "8a", "12p", 4),
    ];
    const nightsOnly = [sel("night", "mon"), sel("night", "tue")];
    const both = [...nightsOnly, sel("morning", "mon"), sel("morning", "tue")];
    const students = () => [
      student("s1@w", { positionId: "barista", selection: nightsOnly, submittedAt: at(1) }),
      student("s2@w", { positionId: "barista", selection: nightsOnly, submittedAt: at(2) }),
      student("s3@w", { positionId: "barista", selection: nightsOnly, submittedAt: at(3) }),
      student("s4@w", { positionId: "barista", selection: both, submittedAt: at(4) }),
    ];

    // Default priority 50: with nights already three quarters full, the empty
    // morning cells pull harder, so the fourth student lands on mornings.
    const balanced = run(students(), blocks);
    const s4 = rowsOf(balanced, "s4@w").map((a) => `${a.blockId}|${a.day}`);
    expect(s4).toContain("morning|mon");
    expect(s4).toContain("morning|tue");
    expect(s4).not.toContain("night|tue");

    // Priority 100 restores fill-nights-completely-first.
    const nightsFirst = generateAssignments({
      students: students(),
      positions: POSITIONS,
      blocks,
      previous: [],
      params: { ...DEFAULT_SCHEDULING_PARAMS, nightPriority: 100 },
    });
    const s4First = rowsOf(nightsFirst, "s4@w").map((a) => `${a.blockId}|${a.day}`);
    expect(s4First).toContain("night|mon");
    expect(s4First).toContain("night|tue");
    expect(s4First).not.toContain("morning|tue");
  });

  it("honors a lower day cap by spreading onto more days", () => {
    const r = generateAssignments({
      students: [
        student("b@w", { positionId: "barista", desiredHours: 12, selection: barSelection }),
      ],
      positions: POSITIONS,
      blocks: barGrid,
      previous: [],
      params: { ...DEFAULT_SCHEDULING_PARAMS, dayCapHours: 6 },
    });
    const report = reportOf(r, "b@w");
    expect(report.daysUsed).toBe(3);
    expect(report.assignedMinutes).toBe(720);
    for (const load of dayLoads(rowsOf(r, "b@w"), barGrid).values()) {
      expect(load).toBeLessThanOrEqual(6 * 60);
    }
    expect(r.report.params?.dayCapHours).toBe(6);
  });

  it("reports students who fall short of their target", () => {
    const blocks = [block("only", "barista", "weekday", "8a", "12p")];
    const r = run(
      [
        student("b@w", {
          positionId: "barista",
          desiredHours: 20,
          selection: [sel("only", "mon"), sel("only", "tue")],
        }),
      ],
      blocks,
    );
    expect(r.report.shortOfTarget).toBe(1);
    expect(reportOf(r, "b@w").assignedMinutes).toBe(480);
  });

  it("counts students left under their position's minimum hours", () => {
    const blocks = [
      block("am", "barista", "weekday", "8a", "12p"),
      block("pm", "barista", "weekday", "12p", "4p"),
    ];
    const r = run(
      [
        // One 4h cell offered, against the position's 10h floor.
        student("thin@w", { positionId: "barista", selection: [sel("am", "mon")] }),
        // Clears the floor at 12h but asked for 20, so short of target only.
        student("wide@w", {
          positionId: "barista",
          desiredHours: 20,
          selection: [sel("am", "mon"), sel("pm", "mon"), sel("am", "tue")],
        }),
      ],
      blocks,
    );
    expect(reportOf(r, "thin@w").assignedMinutes).toBe(240);
    expect(reportOf(r, "wide@w").assignedMinutes).toBe(720);
    expect(r.report.belowMinHours).toBe(1);
    expect(r.report.shortOfTarget).toBe(2);
  });

  describe("labor rules and the relax ladder", () => {
    it("takes a soft-violating non-deferred cell before any deferred cell", () => {
      // The only strict-legal second day is the deferred afternoon; the
      // morning after the Monday night leaves 9h of rest, a soft violation.
      const blocks = [
        block("night", "barista", "weekday", "6p", "10p"),
        block("next-am", "barista", "weekday", "7a", "11a"),
        block("depth", "barista", "weekday", "2p", "6p"),
      ];
      const r = run(
        [
          student("b@w", {
            positionId: "barista",
            desiredHours: 10,
            selection: [sel("night", "mon"), sel("next-am", "tue"), sel("depth", "tue")],
          }),
        ],
        blocks,
        [],
        ["depth"],
      );
      const ids = rowsOf(r, "b@w").map((a) => `${a.blockId}|${a.day}`);
      // Deferred is the last resort: a short-rest (relax-rest) non-deferred
      // cell wins before the deferred cell is even considered.
      expect(ids).toContain("night|mon");
      expect(ids).toContain("next-am|tue");
      expect(ids).not.toContain("depth|tue");
      expect(r.report.laborRelaxed).toEqual({ students: 1 });
    });

    it("takes a clean deferred cell over hard-violating alternatives", () => {
      // Mirror case: the morning after an 11:30p close is a clopen (hard,
      // never relaxed), so the ladder falls through to the deferred cell.
      const blocks = [
        block("night", "barista", "weekday", "6p", "11:30p"),
        block("clopen-am", "barista", "weekday", "5a", "9a"),
        block("depth", "barista", "weekday", "2p", "6p"),
      ];
      const r = run(
        [
          student("b@w", {
            positionId: "barista",
            desiredHours: 10,
            selection: [sel("night", "mon"), sel("clopen-am", "tue"), sel("depth", "tue")],
          }),
        ],
        blocks,
        [],
        ["depth"],
      );
      const ids = rowsOf(r, "b@w").map((a) => `${a.blockId}|${a.day}`);
      expect(ids).toContain("depth|tue");
      expect(ids).not.toContain("clopen-am|tue");
      expect(r.report.laborRelaxed).toEqual({ students: 0 });
    });

    it("places only one of a night close and the next morning open", () => {
      const blocks = [
        block("close", "barista", "weekday", "6p", "11:30p"),
        block("open", "barista", "weekday", "5a", "9a"),
      ];
      const r = run(
        [
          student("b@w", {
            positionId: "barista",
            desiredHours: 10,
            selection: [sel("close", "mon"), sel("open", "tue")],
          }),
        ],
        blocks,
      );
      // 5.5h of rest is under the 8h floor. Clopen is hard, so no ladder mode
      // ever places the pair together; the student lands in belowMinDays.
      expect(rowsOf(r, "b@w").map((a) => a.blockId)).toEqual(["close"]);
      expect(r.report.belowMinDays).toBe(1);
    });

    it("holds a dense student to 5 consecutive days over the cycle", () => {
      const blocks = [
        block("wd", "ca", "weekday", "10a", "2p"),
        block("we", "ca", "weekend", "10a", "2p"),
      ];
      const selection = [
        sel("we", "sun"),
        sel("we", "sat"),
        ...(["mon", "tue", "wed", "thu", "fri"] as const).map((d) => sel("wd", d)),
      ];
      const r = run([student("s@w", { desiredHours: 30, selection })], blocks);
      // Sun (cohort a) through Thu is a run of 5; Fri or Sat would make 6.
      const days = new Set(rowsOf(r, "s@w").map((a) => a.day));
      expect(days).toEqual(new Set(["sun", "mon", "tue", "wed", "thu"]));
      expect(reportOf(r, "s@w").daysUsed).toBe(5);
    });

    it("evaluates an every-weekend opt-in's weekend candidates as 'every'", () => {
      // With both weekend days held, "every" puts them in BOTH halves: the
      // opt-in's week would reach 7 working days (hard), while an A/B student
      // with the same picks stays at 6 (soft, reachable at relax-days). The
      // consecutive-days knob is opened so only the days-per-week rule bites.
      const blocks = [
        block("wd", "ca", "weekday", "10a", "2p"),
        block("we", "ca", "weekend", "10a", "2p"),
      ];
      const selection = [
        sel("we", "sun"),
        sel("we", "sat"),
        ...(["mon", "tue", "wed", "thu", "fri"] as const).map((d) => sel("wd", d)),
      ];
      const r = generateAssignments({
        students: [
          student("opt@w", {
            desiredHours: 28,
            everyWeekendOptIn: true,
            selection,
            submittedAt: at(1),
          }),
          student("twin@w", { desiredHours: 28, selection, submittedAt: at(2) }),
        ],
        positions: POSITIONS,
        blocks,
        previous: [],
        params: { ...DEFAULT_SCHEDULING_PARAMS, maxConsecutiveDays: 14 },
      });
      // The A/B twin takes Saturday (6 days per half); the opt-in is refused
      // it, which is only explainable by the "every" evaluation.
      expect(rowsOf(r, "twin@w").some((a) => a.day === "sat")).toBe(true);
      const optDays = rowsOf(r, "opt@w").map((a) => a.day);
      expect(optDays).toContain("sun");
      expect(optDays).not.toContain("sat");
      expect(reportOf(r, "opt@w").daysUsed).toBe(6);
      expect(r.report.laborRelaxed).toEqual({ students: 2 });
    });
  });

  describe("repeat-start penalty", () => {
    const blocks = [
      block("s1", "barista", "weekday", "8a", "1p"),
      block("s2", "barista", "weekday", "9a", "2p"),
    ];
    const selection = [sel("s1", "mon"), sel("s2", "mon"), sel("s1", "tue"), sel("s2", "tue")];

    // Was run at the shipped default, which P5 tuning moved from 0 to 20; the
    // rule under test is "penalty 0 is a no-op", so 0 is now pinned explicitly.
    it("is a no-op at penalty 0: the block-id tie-break welds both days", () => {
      const r = generateAssignments({
        students: [student("b@w", { positionId: "barista", selection })],
        positions: POSITIONS,
        blocks,
        previous: [],
        params: { ...DEFAULT_SCHEDULING_PARAMS, repeatStartPenalty: 0 },
      });
      const byDay = (day: string) =>
        rowsOf(r, "b@w")
          .filter((a) => a.day === day)
          .map((a) => a.blockId);
      expect(byDay("mon")).toEqual(["s1"]);
      expect(byDay("tue")).toEqual(["s1"]);
    });

    it("splits the same two days at the shipped default, which is no longer 0", () => {
      const r = run([student("b@w", { positionId: "barista", selection })], blocks);
      const byDay = (day: string) =>
        rowsOf(r, "b@w")
          .filter((a) => a.day === day)
          .map((a) => a.blockId);
      expect(byDay("mon")).toEqual(["s1"]);
      expect(byDay("tue")).toEqual(["s2"]);
    });

    it("diversifies start times at a positive penalty", () => {
      const r = generateAssignments({
        students: [student("b@w", { positionId: "barista", selection })],
        positions: POSITIONS,
        blocks,
        previous: [],
        params: { ...DEFAULT_SCHEDULING_PARAMS, repeatStartPenalty: 60 },
      });
      const byDay = (day: string) =>
        rowsOf(r, "b@w")
          .filter((a) => a.day === day)
          .map((a) => a.blockId);
      expect(byDay("mon")).toEqual(["s1"]);
      expect(byDay("tue")).toEqual(["s2"]); // the repeated 8a start is penalized below the fresh 9a one
    });

    it("applies the penalty in the fill loop, not only while seeding", () => {
      // Mon and Tue start apart so the seeds are penalty-free and stable;
      // only the Wed fill step ever sees a repeated start.
      const perDay = [
        block("m1", "barista", "weekday", "8a", "12p"),
        block("t1", "barista", "weekday", "10a", "2p"),
        block("w1", "barista", "weekday", "8a", "12p"),
        block("w2", "barista", "weekday", "9a", "1p"),
      ];
      const pick = (repeatStartPenalty: number) => {
        const r = generateAssignments({
          students: [
            student("b@w", {
              positionId: "barista",
              desiredHours: 12,
              selection: [sel("m1", "mon"), sel("t1", "tue"), sel("w1", "wed"), sel("w2", "wed")],
            }),
          ],
          positions: POSITIONS,
          blocks: perDay,
          previous: [],
          params: { ...DEFAULT_SCHEDULING_PARAMS, repeatStartPenalty },
        });
        return rowsOf(r, "b@w")
          .filter((a) => a.day === "wed")
          .map((a) => a.blockId);
      };
      // The third day comes from the fill loop, after both seeds are placed.
      expect(pick(0)).toEqual(["w1"]); // tie on pull, block id decides
      expect(pick(60)).toEqual(["w2"]); // Mon's 8a start sinks w1 below the fresh 9a
    });

    it("never lifts an untargeted cell over a penalized targeted one", () => {
      const tiered = [
        block("t1", "barista", "weekday", "8a", "12p", 9),
        block("t2", "barista", "weekday", "8a", "12p", 9),
        block("u2", "barista", "weekday", "9a", "1p"),
      ];
      const r = generateAssignments({
        students: [
          student("b@w", {
            positionId: "barista",
            selection: [sel("t1", "mon"), sel("t2", "tue"), sel("u2", "tue")],
          }),
        ],
        positions: POSITIONS,
        blocks: tiered,
        previous: [],
        params: { ...DEFAULT_SCHEDULING_PARAMS, repeatStartPenalty: 100 },
      });
      // At penalty 100 the repeated-start t2 pulls 0 while u2 pulls above it,
      // but targeted cells still outrank untargeted ones, so t2 seeds Tuesday.
      expect(rowsOf(r, "b@w")[1]).toMatchObject({ blockId: "t2", day: "tue" });
    });
  });

  it("seats fill-ins in hashed-email order, not alphabetical", () => {
    // Chosen so the two orders disagree; computed here so the fixture cannot
    // rot silently if the emails change.
    expect(orderHash("c@w")).toBeGreaterThan(orderHash("d@w"));
    const tight = [block("only", "ca", "weekday", "8a", "4p", 1)];
    const selection = [sel("only", "mon")];
    const r = run(
      [
        student("c@w", { fillIn: true, submittedAt: null, selection }),
        student("d@w", { fillIn: true, submittedAt: null, selection }),
      ],
      tight,
    );
    expect(r.assignments.map((a) => a.studentEmail)).toEqual(["d@w"]);
  });

  it("is deterministic on a dense mixed fixture, ladder included", () => {
    const blocks = [
      block("am", "ca", "weekday", "8a", "12p", 2),
      block("pm", "ca", "weekday", "12p", "5p", 2),
      block("we", "ca", "weekend", "10a", "6p", 2),
      block("we-late", "ca", "weekend", "3p", "11p", 2),
      // A close-then-open pair 9h apart: reaching minimums through it needs
      // the relax-rest rung, so this fixture exercises the ladder too.
      block("cl", "ca", "weekday", "2p", "10p"),
      block("op", "ca", "weekday", "7a", "11a"),
    ];
    const everywhere = [
      ...(["mon", "tue", "wed", "thu", "fri"] as const).flatMap((d) => [
        sel("am", d),
        sel("pm", d),
      ]),
      ...(["sat", "sun"] as const).flatMap((d) => [sel("we", d), sel("we-late", d)]),
    ];
    const students = [
      ...[1, 2, 3, 4].map((n) =>
        student(`r${n}@w`, { desiredHours: 16, selection: everywhere, submittedAt: at(n) }),
      ),
      student("opt@w", {
        desiredHours: 16,
        everyWeekendOptIn: true,
        selection: everywhere,
        submittedAt: at(5),
      }),
      ...[1, 2].map((n) =>
        student(`f${n}@w`, { submittedAt: null, fillIn: true, selection: everywhere }),
      ),
      student("relax@w", {
        desiredHours: 12,
        selection: [sel("cl", "mon"), sel("op", "tue")],
        submittedAt: at(6),
      }),
    ];
    const first = run(students, blocks, [], ["we-late"]);
    const second = run(students, blocks, [], ["we-late"]);
    expect(second).toEqual(first);
    // The 9h Mon close to Tue open rest is only placeable at relax-rest, so
    // the ladder demonstrably ran inside this determinism check.
    expect(first.report.laborRelaxed).toEqual({ students: 1 });
  });

  // The weekly hour cap (domain/caps.ts) became a hard generation rule in 1.15.
  // It used to clamp `targetMinutes` only, which left the fill loop free to
  // overshoot by a whole block and left seeding unbounded.
  describe("the weekly hour cap as a hard rule", () => {
    // 6h days: 20h divides into neither three of them nor four, so the old
    // overshoot-by-one-block is the difference between 18h and 24h.
    const sixes = (["mon", "tue", "wed", "thu", "fri"] as const).map((d) =>
      block(`six-${d}`, "barista", "weekday", "8a", "2p"),
    );
    const sixSelection = (["mon", "tue", "wed", "thu", "fri"] as const).map((d) =>
      sel(`six-${d}`, d),
    );

    it("stops an international student under 20h where the fill loop used to overshoot", () => {
      const r = run(
        [
          student("i@w", {
            positionId: "barista",
            international: true,
            desiredHours: 40,
            selection: sixSelection,
          }),
        ],
        sixes,
      );
      // Three 6h days is 18h; the fourth would land on 24h, so it is refused.
      expect(reportOf(r, "i@w").assignedMinutes).toBe(1080);
      expect(rowsOf(r, "i@w")).toHaveLength(3);
    });

    it("leaves a domestic student on the same availability to reach their own 30h", () => {
      // Same shifts, same appetite: the cap is per student, not a global ceiling.
      const r = run(
        [
          student("d@w", {
            positionId: "barista",
            desiredHours: 40,
            selection: sixSelection,
          }),
        ],
        sixes,
      );
      expect(reportOf(r, "d@w").assignedMinutes).toBe(1800);
    });

    it("allows a placement that lands exactly on the cap", () => {
      // 4h blocks: the last one takes them from 16h to exactly 20h. Rejecting
      // that would put the engine at odds with the read-time over-max flag,
      // which treats sitting on the cap as fine.
      const r = run(
        [
          student("i@w", {
            positionId: "barista",
            international: true,
            desiredHours: 40,
            selection: barSelection,
          }),
        ],
        barGrid,
      );
      expect(reportOf(r, "i@w").assignedMinutes).toBe(1200);
    });

    it("refuses a min-days seed over the cap, and reports it as below minimum days", () => {
      // A Shift Lead needs three days; three 8h days is 24h, over the 20h cap.
      // The right outcome is a two-day schedule the scheduler is warned about,
      // never a legal-looking third day that breaks the ceiling.
      const blocks = [
        block("sl-mon", "sl", "weekday", "8a", "4p"),
        block("sl-tue", "sl", "weekday", "8a", "4p"),
        block("sl-wed", "sl", "weekday", "8a", "4p"),
      ];
      const r = run(
        [
          student("lead@w", {
            positionId: "sl",
            international: true,
            desiredHours: 40,
            selection: [sel("sl-mon", "mon"), sel("sl-tue", "tue"), sel("sl-wed", "wed")],
          }),
        ],
        blocks,
      );
      expect(reportOf(r, "lead@w").daysUsed).toBe(2);
      expect(reportOf(r, "lead@w").assignedMinutes).toBe(960);
      expect(r.report.belowMinDays).toBe(1);
    });

    describe("the relax ladder cannot open it", () => {
      // Mon closes at 9p and Tue opens at 6a: 9h of rest, under the preferred
      // 10h but over the hard 8h floor, so Tuesday is reachable only at
      // relax-rest. Wednesday sits clear of both neighbours.
      const blocks = [
        block("late-mon", "barista", "weekday", "1p", "9p"),
        block("early-tue", "barista", "weekday", "6a", "2p"),
        block("early-wed", "barista", "weekday", "6a", "2p"),
      ];
      const selection = [sel("late-mon", "mon"), sel("early-tue", "tue"), sel("early-wed", "wed")];

      it("takes the relaxed cell when the cap leaves room", () => {
        const r = run(
          [student("d@w", { positionId: "barista", desiredHours: 40, selection })],
          blocks,
        );
        expect(reportOf(r, "d@w").assignedMinutes).toBe(1440);
        expect(reportOf(r, "d@w").daysUsed).toBe(3);
        expect(r.report.laborRelaxed).toEqual({ students: 1 });
      });

      it("refuses the same cell for an international student, at every rung", () => {
        // Identical availability, identical appetite. The soft rest rule gives
        // way and the cap does not, so the ladder never even records a relax.
        const r = run(
          [
            student("i@w", {
              positionId: "barista",
              international: true,
              desiredHours: 40,
              selection,
            }),
          ],
          blocks,
        );
        expect(reportOf(r, "i@w").assignedMinutes).toBe(960);
        expect(reportOf(r, "i@w").daysUsed).toBe(2);
        expect(r.report.laborRelaxed).toEqual({ students: 0 });
      });
    });

    it("stays deterministic across two runs with the cap binding", () => {
      const students = [
        student("i@w", {
          positionId: "barista",
          international: true,
          desiredHours: 40,
          selection: sixSelection,
          submittedAt: at(1),
        }),
        student("d@w", {
          positionId: "barista",
          desiredHours: 40,
          selection: sixSelection,
          submittedAt: at(2),
        }),
      ];
      expect(run(students, sixes)).toEqual(run(students, sixes));
    });
  });
});
