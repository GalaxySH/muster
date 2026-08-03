/**
 * Pure seed-building for repair-only generation
 * (docs/w2w-shift-plan-roundtrip.md §7). The plan's imported names become
 * carry-forward rows, all or nothing per student: if ANY of a student's
 * placements is broken (unmatched block, cell not in their effective
 * selection, unknown weekend rotation, same-day shift adding no unique
 * coverage, day over the hour cap), the student is not seeded at all and the
 * engine re-solves them completely. Freezing someone on a surviving subset
 * would silently strand them under their hour floor with the shortfall
 * warnings suppressed, which is worse than redoing their week.
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

/** A candidate seed while validation runs; times ride along for the checks. */
interface SeedDraft {
  studentEmail: string;
  blockId: string;
  day: Day;
  cohort: Cohort;
  start: number;
  end: number;
}

export function buildRepairSeeds(
  rows: readonly MatchedPlanRow[],
  emailByName: ReadonlyMap<string, string | null>,
  eligible: ReadonlyMap<string, RepairStudent>,
  weekendCohortByEmail: ReadonlyMap<string, Cohort>,
  dayCapMinutes: number,
): RepairSeedResult {
  const drafts = new Map<string, SeedDraft[]>();
  const broken = new Set<string>();
  const seen = new Set<string>();
  const skippedNames = new Set<string>();
  let skippedCells = 0;

  for (const row of rows) {
    if (row.employeeName === "") continue;
    const email = emailByName.get(row.employeeName);
    if (email === undefined || email === null) {
      skippedNames.add(row.employeeName);
      continue;
    }
    const student = eligible.get(email);
    if (!student) {
      // Not seedable at all: off roster, unsubmitted, or admin-frozen. Their
      // normal path (re-solve, or their kept current rows) already covers them.
      skippedCells += 1;
      continue;
    }
    if (row.matchedBlockId === null) {
      broken.add(email);
      continue;
    }
    if (!student.selection.some((s) => s.blockId === row.matchedBlockId && s.day === row.day)) {
      broken.add(email);
      continue;
    }
    let cohort: Cohort;
    if (dayTypeOf(row.day) === "weekday") {
      cohort = "weekday";
    } else if (student.everyWeekendOptIn) {
      cohort = "every";
    } else {
      const current = weekendCohortByEmail.get(email);
      // "every" from a run made before the student dropped the opt-in is
      // stale; without a real rotation the placement cannot be kept.
      if (current === undefined || current === "weekday" || current === "every") {
        broken.add(email);
        continue;
      }
      cohort = current;
    }
    // Two seats of one cell can carry the same name; one student holds one seat.
    const key = `${email}|${row.matchedBlockId}|${row.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = drafts.get(email) ?? [];
    list.push({
      studentEmail: email,
      blockId: row.matchedBlockId,
      day: row.day,
      cohort,
      start: row.startMinutes,
      end: row.endMinutes,
    });
    drafts.set(email, list);
  }

  // The same-day rules the engine enforces (unique coverage per shift, day
  // cap) apply to seeds too; the plan is a hand-edited file and gets no pass.
  for (const [email, list] of drafts) {
    const byDay = new Map<Day, TimeRange[]>();
    for (const seed of list) {
      const ranges = byDay.get(seed.day) ?? [];
      ranges.push({ start: seed.start, end: seed.end });
      byDay.set(seed.day, ranges);
    }
    for (const ranges of byDay.values()) {
      if (redundantRangeIndex(ranges) >= 0 || coveredMinutes(ranges) > dayCapMinutes) {
        broken.add(email);
        break;
      }
    }
  }

  const byEmail = new Map<string, ScheduleAssignment[]>();
  for (const [email, list] of drafts) {
    if (broken.has(email)) continue;
    byEmail.set(
      email,
      list.map(({ studentEmail, blockId, day, cohort }) => ({
        studentEmail,
        blockId,
        day,
        cohort,
      })),
    );
  }
  return {
    byEmail,
    brokenStudents: [...broken].sort(),
    skippedNames: [...skippedNames].sort(),
    skippedCells,
  };
}
