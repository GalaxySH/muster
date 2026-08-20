import { describe, it, expect, vi } from "vitest";
import { problemGroups } from "@/lib/domain/scheduling/problems";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "@/lib/domain/scheduling/params";
import type { EngineReport, StudentScheduleReport } from "@/lib/domain/scheduling/types";
// Type only: ./data is server-only, and the import is erased before it runs.
import type { StoredRunReport } from "./data";
import {
  laborFindingSections,
  lateStartWarnings,
  localDay,
  runLaborFindings,
  validatorLimits,
  type FrozenReason,
  type LaborFindingView,
  type RunLaborRow,
} from "./run-warnings";

const SEMESTER_START = "2026-09-02";

/** A `date` column as the driver hands it back: midnight in the local zone. */
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

function lateStarts(
  over: Partial<Parameters<typeof lateStartWarnings>[0]> = {},
): ReturnType<typeof lateStartWarnings> {
  return lateStartWarnings({
    assignments: [{ studentEmail: "a@w" }],
    hiredOn: new Map([["a@w", day("2026-09-08")]]),
    positionOf: new Map([["a@w", "ca"]]),
    returnDateOf: new Map([["ca", null]]),
    defaultStart: SEMESTER_START,
    ...over,
  });
}

describe("lateStartWarnings", () => {
  it("flags a hire date after the semester start when the position has none", () => {
    expect(lateStarts()).toEqual([
      {
        email: "a@w",
        hiredOn: "2026-09-08",
        expectedStart: SEMESTER_START,
        positionId: "ca",
      },
    ]);
  });

  it("judges against the position's own return date when it has one", () => {
    expect(lateStarts({ returnDateOf: new Map([["ca", "2026-09-14"]]) })).toEqual([]);
    const earlier = lateStarts({ returnDateOf: new Map([["ca", "2026-08-24"]]) });
    expect(earlier[0]!.expectedStart).toBe("2026-08-24");
  });

  it("does not flag a hire on the expected start itself", () => {
    expect(lateStarts({ hiredOn: new Map([["a@w", day(SEMESTER_START)]]) })).toEqual([]);
  });

  it("does not flag an unknown hire date", () => {
    expect(lateStarts({ hiredOn: new Map([["a@w", null]]) })).toEqual([]);
    expect(lateStarts({ hiredOn: new Map() })).toEqual([]);
  });

  it("covers every email holding a row, once each, ordered by email", () => {
    const warnings = lateStarts({
      assignments: [
        { studentEmail: "zoe@w" },
        { studentEmail: "amy@w" },
        { studentEmail: "zoe@w" },
        { studentEmail: "ontime@w" },
      ],
      hiredOn: new Map([
        ["zoe@w", day("2026-09-20")],
        ["amy@w", day("2026-09-03")],
        ["ontime@w", day("2026-06-01")],
      ]),
      positionOf: new Map([
        ["zoe@w", "ca"],
        ["amy@w", "ca"],
        ["ontime@w", "ca"],
      ]),
    });
    expect(warnings.map((w) => w.email)).toEqual(["amy@w", "zoe@w"]);
  });

  it("falls back to the default start for a student with no position", () => {
    const warnings = lateStarts({ positionOf: new Map([["a@w", null]]) });
    expect(warnings).toEqual([
      { email: "a@w", hiredOn: "2026-09-08", expectedStart: SEMESTER_START, positionId: null },
    ]);
  });

  it("returns nothing when the run holds no rows", () => {
    expect(lateStarts({ assignments: [] })).toEqual([]);
  });

  it("reads the hire day in the frame the driver built it in", () => {
    // mysql2 materializes a `date` column as new Date(y, m - 1, d), local
    // midnight. Reading that through toISOString lands a day early on any host
    // east of UTC, so the day has to come off the local getters.
    const localMidnight = new Date(2026, 8, 3);
    expect(localDay(localMidnight)).toBe("2026-09-03");
    const warnings = lateStarts({ hiredOn: new Map([["a@w", localMidnight]]) });
    expect(warnings[0]!.hiredOn).toBe("2026-09-03");
  });

  it("pads single-digit months and days", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("reads the local calendar day whichever side of UTC the host sits", () => {
    // Midnight catches the bug east of UTC and a late evening catches it west,
    // so between them this fails on any host that reads the UTC frame instead.
    expect(localDay(new Date(2026, 8, 3, 0, 0))).toBe("2026-09-03");
    expect(localDay(new Date(2026, 8, 3, 23, 30))).toBe("2026-09-03");
  });
});

describe("validatorLimits", () => {
  it("maps the params' hours onto the validator's minute fields", () => {
    expect(validatorLimits(DEFAULT_SCHEDULING_PARAMS)).toEqual({
      dayCapMinutes: 480,
      maxConsecutiveDays: 5,
      maxDaysPerWeek: 6,
      preferredDaysPerWeek: 5,
      minRestMinutes: 480,
      preferredRestMinutes: 600,
    });
  });

  it("backfills a stored run that predates the labor params", () => {
    const old = { dayCapHours: 6, nightPriority: 50, eveningPriority: 25 };
    expect(validatorLimits(old)).toEqual({
      ...validatorLimits(DEFAULT_SCHEDULING_PARAMS),
      dayCapMinutes: 360,
    });
  });

  it("uses the defaults when a run stored no params at all", () => {
    expect(validatorLimits(undefined)).toEqual(validatorLimits(DEFAULT_SCHEDULING_PARAMS));
  });
});

/** One 10h Monday, which is over the default 8h day cap. */
function longMonday(over: Partial<RunLaborRow> = {}): RunLaborRow {
  return {
    studentEmail: "a@w",
    blockId: "long",
    day: "mon",
    cohort: "weekday",
    start: 8 * 60,
    end: 18 * 60,
    source: "engine",
    ...over,
  };
}

function studentRow(over: Partial<StudentScheduleReport> = {}): StudentScheduleReport {
  return {
    email: "a@w",
    targetMinutes: 600,
    assignedMinutes: 600,
    daysUsed: 1,
    cohort: null,
    frozen: false,
    ...over,
  };
}

describe("runLaborFindings", () => {
  const names = (email: string) => (email === "a@w" ? "Ada Wong" : email);
  const lookup = (frozenReasonOf: (email: string) => FrozenReason | null = () => null) => ({
    nameOf: names,
    frozenReasonOf,
  });

  it("re-checks the run's rows and names the students", () => {
    const findings = runLaborFindings([longMonday()], { students: [studentRow()] }, lookup());
    expect(findings).toHaveLength(1);
    expect(findings[0]!.displayName).toBe("Ada Wong");
    expect(findings[0]!.violations.map((v) => v.rule)).toEqual(["day-hours"]);
    expect(findings[0]!.violations[0]!.message).toContain("over the 8h day cap");
  });

  it("takes frozen from the report's students, not the rows", () => {
    const kept = runLaborFindings(
      [longMonday()],
      { students: [studentRow({ frozen: true })] },
      lookup(),
    );
    expect(kept[0]!.frozen).toBe(true);
    expect(
      runLaborFindings([longMonday()], { students: [studentRow()] }, lookup())[0]!.frozen,
    ).toBe(false);
  });

  it("carries the read layer's freeze reason onto the finding", () => {
    const scoped = runLaborFindings(
      [longMonday()],
      { students: [studentRow({ frozen: true })] },
      lookup(() => "out-of-scope"),
    );
    expect(scoped[0]!.frozenReason).toBe("out-of-scope");
  });

  it("falls back to kept for a frozen student with no row of their own", () => {
    const orphan = runLaborFindings(
      [longMonday()],
      { students: [studentRow({ frozen: true })] },
      lookup(),
    );
    expect(orphan[0]!.frozenReason).toBe("kept");
  });

  it("leaves the reason null for a student the run did not freeze", () => {
    const moved = runLaborFindings(
      [longMonday()],
      { students: [studentRow()] },
      lookup(() => "marked"),
    );
    expect(moved[0]!.frozenReason).toBeNull();
  });

  it("marks a violation a hand edit contributed to", () => {
    const manual = runLaborFindings(
      [longMonday({ source: "manual" })],
      { students: [studentRow()] },
      lookup(),
    );
    expect(manual[0]!.violations[0]!.involvesManual).toBe(true);
  });

  it("judges against the run's own snapshotted params", () => {
    const roomy = runLaborFindings(
      [longMonday()],
      {
        students: [studentRow()],
        params: { ...DEFAULT_SCHEDULING_PARAMS, dayCapHours: 12 },
      },
      lookup(),
    );
    expect(roomy).toEqual([]);
  });

  it("falls back to the defaults when the stored params are incoherent", () => {
    // A 12h minimum with 4h preferred could never have been saved through the
    // form, so the whole blob drops back to the defaults rather than judging
    // the run against half-sane bounds.
    const incoherent = {
      students: [studentRow()],
      params: { ...DEFAULT_SCHEDULING_PARAMS, minRestHours: 12, preferredRestHours: 4 },
    };
    // 9h rest: fine under the stored 4h preferred, short of the default 10h.
    const shortRest = runLaborFindings(
      [
        longMonday({ blockId: "close", start: 16 * 60, end: 22 * 60 }),
        longMonday({ blockId: "open", day: "tue", start: 7 * 60, end: 12 * 60 }),
      ],
      incoherent,
      lookup(),
    );
    expect(shortRest[0]!.violations.map((v) => [v.rule, v.severity])).toEqual([
      ["short-rest", "soft"],
    ]);
    // 7h rest is under the 8h default minimum, so the hard rule still fires.
    const clopen = runLaborFindings(
      [
        longMonday({ blockId: "close", start: 16 * 60, end: 23 * 60 }),
        longMonday({ blockId: "open", day: "tue", start: 6 * 60, end: 12 * 60 }),
      ],
      incoherent,
      lookup(),
    );
    expect(clopen[0]!.violations.map((v) => [v.rule, v.severity])).toEqual([["clopen", "hard"]]);
  });

  it("still judges the rows when the report carries no student list", () => {
    const findings = runLaborFindings(
      [longMonday()],
      {} as Pick<EngineReport, "students">,
      lookup(),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.frozen).toBe(false);
  });

  it("still judges the rows when the report is corrupt, minus the frozen marks", () => {
    const broken = { students: "not a list" } as unknown as Pick<EngineReport, "students">;
    const findings = runLaborFindings([longMonday()], broken, lookup());
    expect(findings).toHaveLength(1);
    expect(findings[0]!.frozen).toBe(false);
    expect(findings[0]!.frozenReason).toBeNull();
  });

  it("returns nothing and logs when the validation itself throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exploding = {
      students: [studentRow()],
      get params(): SchedulingParams {
        throw new Error("unreadable params");
      },
    };
    expect(runLaborFindings([longMonday()], exploding, lookup())).toEqual([]);
    expect(error).toHaveBeenCalledWith("labor validation failed", expect.any(Error));
    error.mockRestore();
  });

  it("finds nothing in a clean run", () => {
    const rows = [longMonday({ blockId: "short", end: 12 * 60 })];
    expect(runLaborFindings(rows, { students: [studentRow()] }, lookup())).toEqual([]);
  });
});

function finding(over: Partial<LaborFindingView> = {}): LaborFindingView {
  return {
    email: "a@w",
    displayName: "Ada Wong",
    frozen: false,
    frozenReason: null,
    violations: [],
    ...over,
  };
}

describe("laborFindingSections", () => {
  it("puts hard violations before soft ones and counts distinct students", () => {
    const sections = laborFindingSections([
      finding({
        violations: [
          { rule: "day-hours", severity: "hard", message: "too long", involvesManual: false },
          {
            rule: "days-per-week",
            severity: "soft",
            message: "too many days",
            involvesManual: true,
          },
        ],
      }),
      finding({
        email: "b@w",
        displayName: "Bo Wu",
        frozen: true,
        frozenReason: "out-of-scope",
        violations: [
          { rule: "clopen", severity: "hard", message: "no rest", involvesManual: false },
        ],
      }),
    ]);
    expect(sections.map((s) => s.severity)).toEqual(["hard", "soft"]);
    expect(sections[0]!.students).toBe(2);
    expect(sections[0]!.lines.map((l) => l.message)).toEqual(["too long", "no rest"]);
    expect(sections[0]!.lines[0]!.frozenReason).toBeNull();
    // The chip has to keep the read layer's word for it, not flatten to "kept".
    expect(sections[0]!.lines[1]!.frozenReason).toBe("out-of-scope");
    expect(sections[1]!.lines[0]!.involvesManual).toBe(true);
  });

  it("drops a severity nobody violated", () => {
    const sections = laborFindingSections([
      finding({
        violations: [
          { rule: "split-shift", severity: "hard", message: "split", involvesManual: false },
        ],
      }),
    ]);
    expect(sections.map((s) => s.severity)).toEqual(["hard"]);
  });

  it("returns nothing for a clean run", () => {
    expect(laborFindingSections([])).toEqual([]);
  });
});

describe("a pre-overhaul stored run", () => {
  // Exactly what schedule_runs.summary_json held before this branch: no stats,
  // no lateStarts, no laborRelaxed, no belowMinHours, and the old three-field
  // params. It must keep parsing and simply carry no new warnings.
  const OLD_SUMMARY_JSON = JSON.stringify({
    students: [
      {
        email: "a@w",
        targetMinutes: 600,
        assignedMinutes: 240,
        daysUsed: 1,
        cohort: null,
        frozen: false,
      },
      {
        email: "b@w",
        targetMinutes: 900,
        assignedMinutes: 900,
        daysUsed: 3,
        cohort: "a",
        frozen: true,
      },
    ],
    droppedStudents: [],
    droppedBlockGone: 0,
    skippedNoPosition: [],
    shortOfTarget: 1,
    belowMinDays: 1,
    params: { dayCapHours: 8, nightPriority: 50, eveningPriority: 25 },
  });

  const report = JSON.parse(OLD_SUMMARY_JSON) as StoredRunReport;

  it("parses with every new field simply absent", () => {
    expect(report.students).toHaveLength(2);
    expect(report.belowMinHours).toBeUndefined();
    expect(report.lateStarts).toBeUndefined();
    expect(report.laborRelaxed).toBeUndefined();
    expect(report.returners).toBeUndefined();
    // No health section renders for a run generated before the stats existed.
    expect(report.stats).toBeUndefined();
  });

  it("validates its rows against the backfilled labor params", () => {
    const old = { nameOf: (e: string) => e, frozenReasonOf: () => null };
    expect(runLaborFindings([], report, old)).toEqual([]);
    const over = runLaborFindings([longMonday()], report, old);
    expect(over[0]!.violations[0]!.rule).toBe("day-hours");
  });

  it("still derives its problem groups, below-min-hours included", () => {
    const groups = problemGroups(report, {
      nameOf: (e) => e,
      minDaysOf: () => 2,
      minHoursOf: () => 10,
      internationalOf: () => false,
    });
    expect(groups.map((g) => g.kind)).toEqual([
      "short-of-hours",
      "below-min-hours",
      "below-min-days",
    ]);
    // The frozen student stays out of every group here. over-max-hours does read
    // frozen rows, but their 15h is nowhere near the 30h cap.
    for (const group of groups) {
      expect(group.students.map((s) => s.email)).toEqual(["a@w"]);
    }
  });
});
