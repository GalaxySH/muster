/**
 * Problem-student groups behind the run panel's warning lines.
 *
 * Each aggregate warning on /admin/schedule expands to the students behind it,
 * so the derivations here must mirror the engine's counters (engine.ts)
 * exactly: every counter mirroring one looks at non-frozen students only, hours
 * compare with the EPSILON_MINUTES tolerance, and day spans compare against the
 * position minimum. `over-max-hours` is the one group with no engine counter
 * behind it, and it deliberately includes frozen students; see it for why.
 * A fill-in the run found no room for is left out of report.students
 * altogether, which is how that exemption carries over here. droppedBlockGone
 * has no group because the report keeps only a count for it, not who was
 * affected.
 */
import { hourCap } from "../caps";
import { EPSILON_MINUTES } from "./seats";
import type { EngineReport } from "./types";

export type ProblemKind =
  | "dropped"
  | "no-position"
  | "short-of-hours"
  | "below-min-hours"
  | "over-max-hours"
  | "below-min-days";

/** One affected student in a warning's expandable list. */
export interface ProblemStudent {
  email: string;
  name: string;
}

export interface ProblemGroup {
  kind: ProblemKind;
  /** The warning line as the panel shows it, count included. */
  label: string;
  students: ProblemStudent[];
}

/**
 * Assigned under the position's hour floor. The one copy of this test: the
 * warning line, the per-student pill, and the engine's own counter all have to
 * agree on who is below minimum, or the page contradicts itself. Null minimum
 * hours means the position is unknown, which is never below anything.
 */
export function isBelowMinHours(assignedMinutes: number, minHours: number | null): boolean {
  return minHours !== null && assignedMinutes + EPSILON_MINUTES < minHours * 60;
}

/**
 * Assigned over the student's own weekly hour cap: 20h international, 30h
 * otherwise (`domain/caps.ts`). The mirror image of `isBelowMinHours`, epsilon
 * discipline included, so sitting exactly on the cap is never over it.
 *
 * This is the cap's one boundary, and it stops things as well as reports them.
 * Since 1.15 the engine and its improvement pass import it to REFUSE any
 * placement or relocation that would carry a student past their cap, so a
 * generated run cannot be over it. Manual edits still only warn (the schedule
 * belongs to the scheduler), which is what the read-time flag this same
 * predicate backs is for: a hand edit past the cap stays visible.
 */
export function isOverMaxHours(assignedMinutes: number, international: boolean): boolean {
  return assignedMinutes - EPSILON_MINUTES > hourCap(international) * 60;
}

export interface ProblemLookup {
  /** Display name for an email; return the email itself when unknown. */
  nameOf: (email: string) => string;
  /** The minimum day span of the student's position, or null when unknown. */
  minDaysOf: (email: string) => number | null;
  /** The minimum weekly hours of the student's position, or null when unknown. */
  minHoursOf: (email: string) => number | null;
  /** Whether the student is international, which halves their hour cap. */
  internationalOf: (email: string) => boolean;
}

/**
 * The run's warnings with their affected students, in a fixed group order with
 * students sorted by name then email. Groups with nobody in them are omitted,
 * so each label's count equals its list length.
 *
 * The counts equal the report's own aggregates for the run as generated. They
 * are allowed to move away from them afterwards: `loadScheduleForRun` hands in
 * students whose `assignedMinutes` it re-measured from the live assignment
 * rows, so the three hours groups follow hand edits while the stored aggregate
 * stays the number the run was generated with.
 */
export function problemGroups(report: EngineReport, lookup: ProblemLookup): ProblemGroup[] {
  const active = report.students.filter((s) => !s.frozen);
  const short = active.filter((s) => s.assignedMinutes + EPSILON_MINUTES < s.targetMinutes);
  const belowMinHours = active.filter((s) =>
    isBelowMinHours(s.assignedMinutes, lookup.minHoursOf(s.email)),
  );
  // DELIBERATE ASYMMETRY against every other group here: the over-cap list
  // includes FROZEN students. Hand edits on kept rows are the likeliest way
  // someone lands over the cap, and a group that skipped them would go quiet on
  // exactly the case it exists to catch.
  const overMaxHours = report.students.filter((s) =>
    isOverMaxHours(s.assignedMinutes, lookup.internationalOf(s.email)),
  );
  const belowMinDays = active.filter((s) => {
    const minDays = lookup.minDaysOf(s.email);
    return minDays !== null && s.daysUsed < minDays;
  });

  const groups: [ProblemKind, string[], (n: number) => string][] = [
    [
      "dropped",
      report.droppedStudents,
      (n) => `${n} left the roster and ${n === 1 ? "was" : "were"} dropped`,
    ],
    ["no-position", report.skippedNoPosition, (n) => `${n} skipped with no position set`],
    [
      "short-of-hours",
      short.map((s) => s.email),
      (n) => `${n} ${n === 1 ? "student is" : "students are"} short of their hours`,
    ],
    [
      "below-min-hours",
      belowMinHours.map((s) => s.email),
      (n) => `${n} ${n === 1 ? "student is" : "students are"} below their position's minimum hours`,
    ],
    [
      "over-max-hours",
      overMaxHours.map((s) => s.email),
      (n) => `${n} ${n === 1 ? "student is" : "students are"} over their weekly hour maximum`,
    ],
    [
      "below-min-days",
      belowMinDays.map((s) => s.email),
      (n) => `${n} could not span their minimum days`,
    ],
  ];

  return groups
    .filter(([, emails]) => emails.length > 0)
    .map(([kind, emails, label]) => ({
      kind,
      label: label(emails.length),
      students: emails
        .map((email) => ({ email, name: lookup.nameOf(email) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email)),
    }));
}
