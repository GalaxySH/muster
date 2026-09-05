/**
 * Pure builders that turn the imported W2W plan's names into schedule rows.
 *
 * Two readers, one resolution. `resolvePlanCells` walks the assigned rows once
 * (name to student, day to cohort, two seats of one cell to one cell) and both
 * builders take it from there:
 *
 * - `buildRepairSeeds` (docs/w2w-shift-plan-roundtrip.md §7) feeds the
 *   generator. The plan's names become carry-forward rows, all or nothing per
 *   student: if ANY of a student's placements is broken (unmatched block, cell
 *   not in their effective selection, same-day shift adding no unique
 *   coverage, day over the hour cap), the student is not seeded at all and the
 *   engine re-solves them completely. Freezing someone on a surviving subset
 *   would silently strand them under their hour floor with the shortfall
 *   warnings suppressed, which is worse than redoing their week.
 * - `buildPlanRunAssignments` transcribes the plan into a run directly, with
 *   no engine and none of those refusals: the template is the scheduler's
 *   stated intent, not a proposal, so a shift outside a student's stated
 *   availability is still imported.
 *
 * Weekend cells take their rotation from the plan itself: the imported file
 * is one specific week (A or B, chosen at upload), so a weekend name in it
 * means that student works that rotation. Every-weekend opt-ins stay "every".
 */
import { coveredMinutes, redundantRangeIndex } from "../intervals";
import { dayTypeOf, type Day } from "../types";
import type { TimeRange } from "../time";
import type { Cohort, ScheduleAssignment } from "../scheduling/types";
import type { MatchedPlanRow } from "./types";

export interface RepairStudent {
  everyWeekendOptIn: boolean;
  /** The student's effective picks; repair never seeds outside them. */
  selection: { blockId: string; day: Day }[];
}

export interface RepairSeedResult {
  /** Seed rows per student; every listed student is virtually frozen. */
  byEmail: Map<string, ScheduleAssignment[]>;
  /** Students dropped to a full re-solve because a placement broke. */
  brokenStudents: string[];
  /** Imported names that resolve to no student (or ambiguously). */
  skippedNames: string[];
  /** Placements whose student cannot be seeded at all (off-roster,
   * not submitted, or admin-frozen; those students keep their normal path). */
  skippedCells: number;
}

/**
 * Resolve W2W display names to student emails. Mapping names win over
 * roster-derived names; a name claimed twice on either side is ambiguous and
 * resolves to nobody (null), never to an arbitrary student.
 */
export function buildNameIndex(
  mapped: { name: string; email: string }[],
  derived: { name: string; email: string }[],
): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const d of derived) {
    index.set(d.name, index.has(d.name) ? null : d.email);
  }
  const mappedSeen = new Map<string, string | null>();
  for (const m of mapped) {
    mappedSeen.set(m.name, mappedSeen.has(m.name) ? null : m.email);
  }
  for (const [name, email] of mappedSeen) index.set(name, email);
  return index;
}

/**
 * The rotation a plan row's day means. One uploaded file is one specific week,
 * so it cannot tell A from B on its own: the admin says which at upload.
 */
function planCohort(day: Day, everyWeekendOptIn: boolean, planWeek: "a" | "b"): Cohort {
  if (dayTypeOf(day) === "weekday") return "weekday";
  return everyWeekendOptIn ? "every" : planWeek;
}

/** One plan row resolved to a student cell; times ride along for the checks. */
interface PlanCell {
  studentEmail: string;
  /** Null when the row matched no Muster block. */
  blockId: string | null;
  day: Day;
  cohort: Cohort;
  start: number;
  end: number;
}

interface PlanCellResolution {
  /** Cells per student, one per (block, day); duplicate seats collapse. */
  byEmail: Map<string, PlanCell[]>;
  /** Names the index knows nothing about, sorted. */
  unknownNames: string[];
  /** Names claimed by more than one student, sorted. */
  ambiguousNames: string[];
  /** Name by email for rows whose student is not in the caller's set. */
  skippedByEmail: Map<string, string>;
  /** How many rows those students took. */
  skippedRows: number;
}

/**
 * Walk the plan's assigned rows and resolve each to a student cell. The two
 * builders below differ only in what they refuse afterwards, so everything
 * they agree on happens here.
 */
function resolvePlanCells(
  rows: readonly MatchedPlanRow[],
  emailByName: ReadonlyMap<string, string | null>,
  students: ReadonlyMap<string, { everyWeekendOptIn: boolean }>,
  planWeek: "a" | "b",
): PlanCellResolution {
  const byEmail = new Map<string, PlanCell[]>();
  const unknown = new Set<string>();
  const ambiguous = new Set<string>();
  const skippedByEmail = new Map<string, string>();
  const seen = new Set<string>();
  let skippedRows = 0;

  for (const row of rows) {
    if (row.employeeName === "") continue;
    const email = emailByName.get(row.employeeName);
    if (email === undefined) {
      unknown.add(row.employeeName);
      continue;
    }
    if (email === null) {
      ambiguous.add(row.employeeName);
      continue;
    }
    const student = students.get(email);
    if (!student) {
      skippedRows += 1;
      skippedByEmail.set(email, row.employeeName);
      continue;
    }
    // Two seats of one cell can carry the same name; one student holds one seat.
    const key = [email, row.matchedBlockId ?? "", row.day].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byEmail.get(email) ?? [];
    list.push({
      studentEmail: email,
      blockId: row.matchedBlockId,
      day: row.day,
      cohort: planCohort(row.day, student.everyWeekendOptIn, planWeek),
      start: row.startMinutes,
      end: row.endMinutes,
    });
    byEmail.set(email, list);
  }

  return {
    byEmail,
    unknownNames: [...unknown].sort(),
    ambiguousNames: [...ambiguous].sort(),
    skippedByEmail,
    skippedRows,
  };
}

export function buildRepairSeeds(
  rows: readonly MatchedPlanRow[],
  emailByName: ReadonlyMap<string, string | null>,
  eligible: ReadonlyMap<string, RepairStudent>,
  planWeek: "a" | "b",
  dayCapMinutes: number,
): RepairSeedResult {
  const resolved = resolvePlanCells(rows, emailByName, eligible, planWeek);
  const broken = new Set<string>();
  const drafts = new Map<string, PlanCell[]>();

  for (const [email, cells] of resolved.byEmail) {
    const selection = eligible.get(email)!.selection;
    const placeable = cells.every(
      (cell) =>
        cell.blockId !== null &&
        selection.some((s) => s.blockId === cell.blockId && s.day === cell.day),
    );
    if (placeable) drafts.set(email, cells);
    else broken.add(email);
  }

  // The same-day rules the engine enforces (unique coverage per shift, day
  // cap) apply to seeds too; the plan is a hand-edited file and gets no pass.
  for (const [email, cells] of drafts) {
    const byDay = new Map<Day, TimeRange[]>();
    for (const cell of cells) {
      const ranges = byDay.get(cell.day) ?? [];
      ranges.push({ start: cell.start, end: cell.end });
      byDay.set(cell.day, ranges);
    }
    for (const ranges of byDay.values()) {
      if (redundantRangeIndex(ranges) >= 0 || coveredMinutes(ranges) > dayCapMinutes) {
        broken.add(email);
        break;
      }
    }
  }

  const byEmail = new Map<string, ScheduleAssignment[]>();
  for (const [email, cells] of drafts) {
    if (broken.has(email)) continue;
    byEmail.set(
      email,
      cells.map(({ studentEmail, blockId, day, cohort }) => ({
        studentEmail,
        blockId: blockId!,
        day,
        cohort,
      })),
    );
  }
  return {
    byEmail,
    brokenStudents: [...broken].sort(),
    skippedNames: [...resolved.unknownNames, ...resolved.ambiguousNames].sort(),
    skippedCells: resolved.skippedRows,
  };
}

/** A student the plan can be transcribed onto: the roster set, keyed by email. */
export interface PlanRunStudent {
  everyWeekendOptIn: boolean;
}

export interface PlanRunBuild {
  /** One row per (student, block, day) the template assigns. */
  assignments: ScheduleAssignment[];
  /** Names on the template that no single student answers to. */
  unassociatedNames: { name: string; reason: "unknown" | "ambiguous" }[];
  /** Students in the given set the template gives no shift. */
  studentsWithNoAssignments: string[];
  /** Names that resolve to somebody outside the given set (off the roster). */
  skippedOffRoster: { name: string; email: string }[];
}

/** Sort key: locale-free, so the row order never varies by host. */
const assignmentKey = (a: ScheduleAssignment) => [a.studentEmail, a.day, a.blockId].join("|");

/**
 * Transcribe the plan's assigned seats into schedule rows verbatim. Nothing is
 * solved and nothing is invented: a row no Muster block matches is left out
 * (the match report already lists those shapes), a name nobody answers to is
 * reported, and a name belonging to somebody off the roster is skipped, since
 * they are not schedulable.
 */
export function buildPlanRunAssignments(
  rows: readonly MatchedPlanRow[],
  emailByName: ReadonlyMap<string, string | null>,
  students: ReadonlyMap<string, PlanRunStudent>,
  planWeek: "a" | "b",
): PlanRunBuild {
  const resolved = resolvePlanCells(rows, emailByName, students, planWeek);

  const assignments: ScheduleAssignment[] = [];
  for (const cells of resolved.byEmail.values()) {
    for (const cell of cells) {
      if (cell.blockId === null) continue;
      assignments.push({
        studentEmail: cell.studentEmail,
        blockId: cell.blockId,
        day: cell.day,
        cohort: cell.cohort,
        // A human wrote these in W2W, so they are never the engine's.
        source: "manual",
      });
    }
  }
  assignments.sort((a, b) => {
    const [x, y] = [assignmentKey(a), assignmentKey(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const covered = new Set(assignments.map((a) => a.studentEmail));
  return {
    assignments,
    unassociatedNames: [
      ...resolved.unknownNames.map((name) => ({ name, reason: "unknown" as const })),
      ...resolved.ambiguousNames.map((name) => ({ name, reason: "ambiguous" as const })),
    ],
    studentsWithNoAssignments: [...students.keys()].filter((e) => !covered.has(e)).sort(),
    skippedOffRoster: [...resolved.skippedByEmail]
      .map(([email, name]) => ({ name, email }))
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0)),
  };
}
