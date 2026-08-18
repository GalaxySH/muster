/**
 * Scenarios for the independent labor validator, constructed from the spec alone
 * (docs/constraints-from-welcome-week.md §1 and the fortnight calendar in
 * docs/generator-constraints-fairness-plan.md §1), never from the engine's labor
 * module. Exact message assertions are deliberate: they pin this implementation's
 * verdicts so a cross-check against labor.ts can diff behavior, not just shape.
 */
import { describe, expect, it } from "vitest";
import type { Day } from "../types";
import type { Cohort } from "./types";
import { validateRunLabor, type ValidatorLimits, type ValidatorRow } from "./validate";

/** The one-off's real limits: 8h day, 5 consecutive, 6 days hard 5 soft, 8h/10h rest. */
const LIMITS: ValidatorLimits = {
  dayCapMinutes: 480,
  maxConsecutiveDays: 5,
  maxDaysPerWeek: 6,
  preferredDaysPerWeek: 5,
  minRestMinutes: 480,
  preferredRestMinutes: 600,
};

function row(
  partial: Partial<ValidatorRow> & Pick<ValidatorRow, "day" | "cohort" | "start" | "end">,
): ValidatorRow {
  return {
    studentEmail: "s@wisc.edu",
    blockId: "block",
    source: "engine",
    frozen: false,
    ...partial,
  };
}

/** One weekday-cohort row per Mon..Fri, all with the same times. */
function weekdays(start: number, end: number, partial: Partial<ValidatorRow> = {}): ValidatorRow[] {
  return (["mon", "tue", "wed", "thu", "fri"] as const).map((day) =>
    row({ day, cohort: "weekday", start, end, ...partial }),
  );
}

function check(rows: ValidatorRow[], overrides: Partial<ValidatorLimits> = {}) {
  return validateRunLabor(rows, { ...LIMITS, ...overrides });
}

describe("split-shift", () => {
  it("flags a gapped day once, even though a weekday row occupies both fortnight halves", () => {
    const findings = check([
      row({ day: "wed", cohort: "weekday", start: 480, end: 720 }),
      row({ day: "wed", cohort: "weekday", start: 960, end: 1200 }),
    ]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "split-shift",
            severity: "hard",
            message: "Wed has a split shift: 08:00 to 12:00 and 16:00 to 20:00",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("does not flag an exact abutment; the second shift extends the first", () => {
    const findings = check([
      row({ day: "wed", cohort: "weekday", start: 480, end: 720 }),
      row({ day: "wed", cohort: "weekday", start: 720, end: 960 }),
    ]);
    expect(findings).toEqual([]);
  });

  it("does not flag a staggered double, and counts the shared minutes once", () => {
    // Raw lengths sum to 13h; the merged span is 08:00 to 16:00, exactly the 8h cap.
    const findings = check([
      row({ day: "wed", cohort: "weekday", start: 480, end: 960 }),
      row({ day: "wed", cohort: "weekday", start: 600, end: 900 }),
    ]);
    expect(findings).toEqual([]);
  });

  it("does not read the same day of week in different rotation cohorts as a split", () => {
    // Rotation A's Saturday is slot 6 and rotation B's is slot 13: different days.
    const findings = check([
      row({ day: "sat", cohort: "a", start: 480, end: 720 }),
      row({ day: "sat", cohort: "b", start: 960, end: 1200 }),
    ]);
    expect(findings).toEqual([]);
  });
});

describe("day-hours", () => {
  it("flags a single row one minute over the day cap", () => {
    const findings = check([row({ day: "wed", cohort: "weekday", start: 480, end: 961 })]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "day-hours",
            severity: "hard",
            message: "Wed totals 8.02h, over the 8h day cap",
            involvesManual: false,
          },
        ],
      },
    ]);
  });
});

describe("week-hours", () => {
  it("flags only the fortnight half that exceeds 40h", () => {
    // Mon..Fri at 8h fills both halves to exactly 2400; the rotation A Saturday
    // adds an hour to week 1 only.
    const findings = check(
      [...weekdays(480, 960), row({ day: "sat", cohort: "a", start: 480, end: 540 })],
      { maxConsecutiveDays: 6, preferredDaysPerWeek: 6 },
    );
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "week-hours",
            severity: "hard",
            message: "Week 1 totals 41h, over the 40h weekly cap",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("keeps the 40h cap constant even when the day cap is raised", () => {
    // Five 9h days pass a 10h day cap but break 40h in both halves.
    const findings = check(weekdays(0, 540), { dayCapMinutes: 600 });
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "week-hours",
            severity: "hard",
            message: "Week 1 totals 45h, over the 40h weekly cap",
            involvesManual: false,
          },
          {
            rule: "week-hours",
            severity: "hard",
            message: "Week 2 totals 45h, over the 40h weekly cap",
            involvesManual: false,
          },
        ],
      },
    ]);
  });
});

describe("days-per-week", () => {
  it("flags seven days in one half as hard", () => {
    // Mon..Fri plus the A Saturday (slot 6) plus the B Sunday (slot 0) puts
    // seven occupied slots into week 1; week 2 keeps five.
    const findings = check(
      [
        ...weekdays(480, 540),
        row({ day: "sat", cohort: "a", start: 480, end: 540 }),
        row({ day: "sun", cohort: "b", start: 480, end: 540 }),
      ],
      { maxConsecutiveDays: 12 },
    );
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "days-per-week",
            severity: "hard",
            message: "Week 1 has 7 work days, over the max of 6",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("flags six days as soft when over the preferred count but at the hard max", () => {
    const findings = check(
      [...weekdays(480, 540), row({ day: "sat", cohort: "a", start: 480, end: 540 })],
      { maxConsecutiveDays: 12 },
    );
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "days-per-week",
            severity: "soft",
            message: "Week 1 has 6 work days, more than the preferred 5",
            involvesManual: false,
          },
        ],
      },
    ]);
  });
});

describe("consecutive-days", () => {
  it("accepts a weekday-only Mon to Fri pattern at exactly the max of 5", () => {
    // Five days per half, runs of exactly five, rest of 17h overnight: fully legal.
    expect(check(weekdays(480, 900))).toEqual([]);
  });

  it("flags a six day run when the A weekend Saturday extends the work week", () => {
    const findings = check(
      [...weekdays(480, 540), row({ day: "sat", cohort: "a", start: 480, end: 540 })],
      { preferredDaysPerWeek: 6 },
    );
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "consecutive-days",
            severity: "hard",
            message: "Works 6 days in a row, over the max of 5",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("counts a run across the 13 to 0 wrap: B Saturday, B Sunday, then Monday", () => {
    // Slots 13, 0 and 1 are cyclically consecutive; the second Monday copy (slot 8)
    // stands alone.
    const findings = check(
      [
        row({ day: "sat", cohort: "b", start: 480, end: 540 }),
        row({ day: "sun", cohort: "b", start: 480, end: 540 }),
        row({ day: "mon", cohort: "weekday", start: 480, end: 540 }),
      ],
      { maxConsecutiveDays: 2 },
    );
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "consecutive-days",
            severity: "hard",
            message: "Works 3 days in a row, over the max of 2",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("flags a rotation student's 12 day stretch across the fortnight", () => {
    // Weekday rows fill slots 1..5 and 8..12; the A weekend bridges them with
    // slots 6 and 7 for a single run of 12.
    const findings = check(
      [
        ...weekdays(480, 540),
        row({ day: "sat", cohort: "a", start: 480, end: 540 }),
        row({ day: "sun", cohort: "a", start: 480, end: 540 }),
      ],
      { preferredDaysPerWeek: 6 },
    );
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "consecutive-days",
            severity: "hard",
            message: "Works 12 days in a row, over the max of 5",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("reports an every-weekend student occupying all 14 slots as one run of 14", () => {
    const findings = check([
      ...weekdays(480, 540),
      row({ day: "sat", cohort: "every", start: 480, end: 540 }),
      row({ day: "sun", cohort: "every", start: 480, end: 540 }),
    ]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "consecutive-days",
            severity: "hard",
            message: "Works 14 days in a row with no day off, over the max of 5",
            involvesManual: false,
          },
          {
            rule: "days-per-week",
            severity: "hard",
            message: "Week 1 has 7 work days, over the max of 6",
            involvesManual: false,
          },
          {
            rule: "days-per-week",
            severity: "hard",
            message: "Week 2 has 7 work days, over the max of 6",
            involvesManual: false,
          },
        ],
      },
    ]);
  });
});

describe("clopen and short-rest", () => {
  it("flags a clopen across the 13 to 0 wrap: B Saturday close against B Sunday open", () => {
    const findings = check([
      row({ day: "sat", cohort: "b", start: 960, end: 1410 }),
      row({ day: "sun", cohort: "b", start: 360, end: 720 }),
    ]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "clopen",
            severity: "hard",
            message: "Sat close 23:30 to Sun open 06:00 is 6.5h rest",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("flags rest at exactly the hard floor as short-rest, not clopen", () => {
    // 22:00 close to 06:00 open is exactly 8h: meets the floor, under the 10h preference.
    const findings = check([
      row({ day: "mon", cohort: "weekday", start: 960, end: 1320 }),
      row({ day: "tue", cohort: "weekday", start: 360, end: 720 }),
    ]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "short-rest",
            severity: "soft",
            message: "Mon close 22:00 to Tue open 06:00 is 8h rest",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("flags nothing at exactly the preferred rest", () => {
    const findings = check([
      row({ day: "mon", cohort: "weekday", start: 960, end: 1320 }),
      row({ day: "tue", cohort: "weekday", start: 480, end: 840 }),
    ]);
    expect(findings).toEqual([]);
  });

  it("flags rest one minute under the hard floor as clopen", () => {
    const findings = check([
      row({ day: "mon", cohort: "weekday", start: 960, end: 1320 }),
      row({ day: "tue", cohort: "weekday", start: 359, end: 719 }),
    ]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "clopen",
            severity: "hard",
            message: "Mon close 22:00 to Tue open 05:59 is 7.98h rest",
            involvesManual: false,
          },
        ],
      },
    ]);
  });
});

describe("manual and frozen attribution", () => {
  it("marks involvesManual when a manual row trips day-hours, and orders findings by email", () => {
    const findings = check([
      row({ studentEmail: "bob@wisc.edu", day: "wed", cohort: "weekday", start: 480, end: 961 }),
      row({
        studentEmail: "alice@wisc.edu",
        day: "wed",
        cohort: "weekday",
        start: 480,
        end: 961,
        source: "manual",
      }),
    ]);
    expect(findings.map((f) => f.email)).toEqual(["alice@wisc.edu", "bob@wisc.edu"]);
    expect(findings[0]?.violations).toEqual([
      {
        rule: "day-hours",
        severity: "hard",
        message: "Wed totals 8.02h, over the 8h day cap",
        involvesManual: true,
      },
    ]);
    expect(findings[1]?.violations[0]?.involvesManual).toBe(false);
  });

  it("marks a rest violation manual when either slot of the pair holds a manual row", () => {
    const findings = check([
      row({ day: "mon", cohort: "weekday", start: 960, end: 1320 }),
      row({ day: "tue", cohort: "weekday", start: 360, end: 720, source: "manual" }),
    ]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "short-rest",
            severity: "soft",
            message: "Mon close 22:00 to Tue open 06:00 is 8h rest",
            involvesManual: true,
          },
        ],
      },
    ]);
  });

  it("marks the finding frozen when any of the student's rows is frozen", () => {
    const findings = check([
      row({
        studentEmail: "frida@wisc.edu",
        day: "mon",
        cohort: "weekday",
        start: 480,
        end: 540,
        frozen: true,
      }),
      row({ studentEmail: "frida@wisc.edu", day: "wed", cohort: "weekday", start: 480, end: 961 }),
      row({ studentEmail: "gary@wisc.edu", day: "wed", cohort: "weekday", start: 480, end: 961 }),
    ]);
    expect(findings.map((f) => [f.email, f.frozen])).toEqual([
      ["frida@wisc.edu", true],
      ["gary@wisc.edu", false],
    ]);
  });
});

describe("robustness and determinism", () => {
  it("returns nothing for empty input", () => {
    expect(check([])).toEqual([]);
  });

  it("ignores rows with unknown or misplaced day and cohort values without throwing", () => {
    // Each bad row spans 24h; if any of them were mapped onto the fortnight the
    // Wed verdict below would change.
    const findings = check([
      row({ day: "funday" as Day, cohort: "weekday", start: 0, end: 1440 }),
      row({ day: "wed", cohort: "c" as Cohort, start: 0, end: 1440 }),
      row({ day: "mon", cohort: "a", start: 0, end: 1440 }),
      row({ day: "wed", cohort: "weekday", start: 480, end: 961 }),
    ]);
    expect(findings).toEqual([
      {
        email: "s@wisc.edu",
        frozen: false,
        violations: [
          {
            rule: "day-hours",
            severity: "hard",
            message: "Wed totals 8.02h, over the 8h day cap",
            involvesManual: false,
          },
        ],
      },
    ]);
  });

  it("orders a student's violations hard first, then by rule name", () => {
    const findings = check([
      row({ day: "wed", cohort: "weekday", start: 480, end: 720 }),
      row({ day: "wed", cohort: "weekday", start: 900, end: 1210 }),
      row({ day: "mon", cohort: "weekday", start: 960, end: 1320 }),
      row({ day: "tue", cohort: "weekday", start: 360, end: 720 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.violations.map((v) => [v.rule, v.severity])).toEqual([
      ["day-hours", "hard"],
      ["split-shift", "hard"],
      ["short-rest", "soft"],
    ]);
  });

  it("produces deeply equal output for the same input", () => {
    const rows = [
      row({ studentEmail: "zoe@wisc.edu", day: "wed", cohort: "weekday", start: 480, end: 720 }),
      row({ studentEmail: "zoe@wisc.edu", day: "wed", cohort: "weekday", start: 960, end: 1200 }),
      row({ studentEmail: "amy@wisc.edu", day: "sat", cohort: "b", start: 960, end: 1410 }),
      row({ studentEmail: "amy@wisc.edu", day: "sun", cohort: "b", start: 360, end: 720 }),
    ];
    const first = check(rows);
    const second = check(rows);
    expect(second).toEqual(first);
    expect(first.map((f) => f.email)).toEqual(["amy@wisc.edu", "zoe@wisc.edu"]);
  });
});
