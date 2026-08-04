import "server-only";

/**
 * Server wrapper for repair-only generation seeds
 * (docs/w2w-shift-plan-roundtrip.md §7): loads the current plan, the identity
 * mapping, and the roster, then hands everything to the pure seed builder in
 * src/lib/domain/w2w-plan/repair-seeds.ts, which owns all the semantics
 * (all-or-nothing per student, ambiguity, cohorts, same-day rules).
 */
import { getDb } from "@/lib/db";
import { students, w2wEmployees } from "@/lib/db/schema";
import { matchPlan } from "@/lib/domain/w2w-plan/match";
import { deriveW2wName } from "@/lib/domain/w2w-plan/identity";
import {
  buildNameIndex,
  buildRepairSeeds,
  type RepairSeedResult,
  type RepairStudent,
} from "@/lib/domain/w2w-plan/repair-seeds";
import { getCurrentPlan, loadPlanMatchInputs } from "./plan-data";

export type { RepairStudent as RepairEligibleStudent } from "@/lib/domain/w2w-plan/repair-seeds";

/** Null when no plan is imported (repair mode cannot run). */
export async function loadRepairSeeds(
  eligible: Map<string, RepairStudent>,
  dayCapMinutes: number,
): Promise<RepairSeedResult | null> {
  const plan = await getCurrentPlan();
  if (!plan) return null;

  const db = getDb();
  const [inputs, mappedRows, rosterRows] = await Promise.all([
    loadPlanMatchInputs(),
    db.select({ email: w2wEmployees.email, name: w2wEmployees.w2wName }).from(w2wEmployees),
    db.select({ email: students.email, displayName: students.displayName }).from(students),
  ]);
  const report = matchPlan(plan.rows, inputs.map, inputs.blocks);

  const emailByName = buildNameIndex(
    mappedRows,
    rosterRows.map((r) => ({ name: deriveW2wName(r.displayName), email: r.email })),
  );
  return buildRepairSeeds(
    report.rows,
    emailByName,
    eligible,
    plan.meta.rotationWeek,
    dayCapMinutes,
  );
}
