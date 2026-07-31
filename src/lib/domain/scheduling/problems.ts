/**
 * Problem-student groups behind the run panel's warning lines.
 *
 * Each aggregate warning on /admin/schedule expands to the students behind it,
 * so the derivations here must mirror the engine's counters (engine.ts)
 * exactly: both counters look at non-frozen students only, hours compare with
 * the EPSILON_MINUTES tolerance, and day spans compare against the position
 * minimum. droppedBlockGone has no group because the report keeps only a count
 * for it, not who was affected.
 */
import { EPSILON_MINUTES } from "./seats";
import type { EngineReport } from "./types";

export type ProblemKind = "dropped" | "no-position" | "short-of-hours" | "below-min-days";

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

export interface ProblemLookup {
  /** Display name for an email; return the email itself when unknown. */
  nameOf: (email: string) => string;
  /** The minimum day span of the student's position, or null when unknown. */
  minDaysOf: (email: string) => number | null;
}

/**
 * The run's warnings with their affected students, in a fixed group order with
 * students sorted by name then email. Groups with nobody in them are omitted,
 * so each label's count equals its list length and matches the report's
 * aggregate number.
 */
export function problemGroups(report: EngineReport, lookup: ProblemLookup): ProblemGroup[] {
  const active = report.students.filter((s) => !s.frozen);
  const short = active.filter((s) => s.assignedMinutes + EPSILON_MINUTES < s.targetMinutes);
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
