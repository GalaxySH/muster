import "server-only";

/**
 * Repair-only generation seeds (docs/w2w-shift-plan-roundtrip.md §7): turn the
 * assignments riding in on the imported W2W plan into carry-forward rows, so
 * an Update can keep everyone the plan already places and only fill gaps or
 * relocate people whose imported placement broke.
 *
 * A placement is kept when the name resolves to exactly one student, that
 * student is eligible (submitted, on roster), the row matches a block, the
 * student still selects that block on that day, and a rotation is known for
 * weekend cells (every-weekend opt-in, or the cohort their current schedule
 * already uses). Anything else is skipped and reported; the engine re-solves
 * those students normally.
 */
import { getDb } from "@/lib/db";
import { students, w2wEmployees } from "@/lib/db/schema";
import { matchPlan } from "@/lib/domain/w2w-plan/match";
import { deriveW2wName } from "@/lib/domain/w2w-plan/identity";
import { dayTypeOf, type Day } from "@/lib/domain/types";
import type { Cohort, ScheduleAssignment } from "@/lib/domain/scheduling/types";
import { getCurrentPlan, loadPlanMatchInputs } from "./plan-data";

export interface RepairEligibleStudent {
  everyWeekendOptIn: boolean;
  /** The student's current picks, the bound repair must stay inside. */
  selection: { blockId: string; day: Day }[];
}

export interface RepairSeeds {
  /** Seed rows per student; every listed student is virtually frozen. */
  byEmail: Map<string, ScheduleAssignment[]>;
  /** Imported names that resolve to no student (or ambiguously). */
  skippedNames: string[];
  /** Resolved placements that were invalid and fall back to the engine. */
  skippedCells: number;
}

/** Null when no plan is imported (repair mode cannot run). */
export async function loadRepairSeeds(
  eligible: Map<string, RepairEligibleStudent>,
  weekendCohortByEmail: Map<string, Cohort>,
): Promise<RepairSeeds | null> {
  const plan = await getCurrentPlan();
  if (!plan) return null;

  const db = getDb();
  const [inputs, mappedRows, rosterRows] = await Promise.all([
    loadPlanMatchInputs(),
    db.select({ email: w2wEmployees.email, name: w2wEmployees.w2wName }).from(w2wEmployees),
    db.select({ email: students.email, displayName: students.displayName }).from(students),
  ]);
  const report = matchPlan(plan.rows, inputs.map, inputs.blocks);

  // Name resolution: the mapping wins; roster-derived names fill in behind it.
  // A derived name shared by two students is ambiguous and resolves to nobody.
  const emailByName = new Map<string, string | null>();
  for (const r of rosterRows) {
    const derived = deriveW2wName(r.displayName);
    emailByName.set(derived, emailByName.has(derived) ? null : r.email);
  }
  for (const m of mappedRows) emailByName.set(m.name, m.email);

  const byEmail = new Map<string, ScheduleAssignment[]>();
  const seen = new Set<string>();
  const skippedNames = new Set<string>();
  let skippedCells = 0;

  for (const row of report.rows) {
    if (row.employeeName === "") continue;
    const email = emailByName.get(row.employeeName);
    if (email === undefined || email === null) {
      skippedNames.add(row.employeeName);
      continue;
    }
    const student = eligible.get(email);
    if (!student || row.matchedBlockId === null) {
      skippedCells += 1;
      continue;
    }
    if (!student.selection.some((s) => s.blockId === row.matchedBlockId && s.day === row.day)) {
      skippedCells += 1;
      continue;
    }
    let cohort: Cohort;
    if (dayTypeOf(row.day) === "weekday") {
      cohort = "weekday";
    } else if (student.everyWeekendOptIn) {
      cohort = "every";
    } else {
      const current = weekendCohortByEmail.get(email);
      if (current === undefined || current === "weekday") {
        skippedCells += 1;
        continue;
      }
      cohort = current;
    }
    // Two seats of one cell can carry the same name; one student holds one seat.
    const key = `${email}|${row.matchedBlockId}|${row.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byEmail.get(email) ?? [];
    list.push({ studentEmail: email, blockId: row.matchedBlockId, day: row.day, cohort });
    byEmail.set(email, list);
  }

  return { byEmail, skippedNames: [...skippedNames].sort(), skippedCells };
}
