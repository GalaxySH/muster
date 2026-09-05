import "server-only";

/**
 * Everything an uploaded shift plan means, computed from the bytes alone
 * (docs/w2w-shift-plan-roundtrip.md §10). The console action runs this twice:
 * once to show the confirmation screen and once on the confirmed import, so
 * what gets written is always derived from the file on the server and never
 * from anything the browser sends back.
 *
 * Nothing here writes. The position-map seed rows come back as data for the
 * commit to persist, so a cancelled preview leaves the database untouched.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, students, submissions, w2wEmployees } from "@/lib/db/schema";
import { effectiveRotation } from "@/lib/availability/effective";
import { loadInternalCopiesByEmail } from "@/lib/availability/internal";
import { onRosterStudent } from "@/lib/roster/lookup";
import { decodeCp1252 } from "@/lib/text/cp1252";
import { deriveW2wName } from "@/lib/domain/w2w-plan/identity";
import { matchPlan } from "@/lib/domain/w2w-plan/match";
import { parseW2wPlan } from "@/lib/domain/w2w-plan/parse";
import {
  buildNameIndex,
  buildPlanRunAssignments,
  type PlanRunBuild,
} from "@/lib/domain/w2w-plan/repair-seeds";
import type { PlanMatchReport, W2wPlanRow, W2wPositionMapEntry } from "@/lib/domain/w2w-plan/types";
import { W2W_POSITION_MAP_SEED } from "./position-map-seed";
import { loadPlanMatchInputs } from "./plan-data";

/**
 * What a student's hours and day span have to be measured against. Read here
 * and handed over as plain numbers because the measuring itself is the
 * generator's, and W2W does not import the generator.
 */
export interface PlanStudentFacts {
  international: boolean;
  desiredHours: number | null;
  /** From the student's position; null when they have none. */
  minHours: number | null;
  minDays: number | null;
}

export interface PlanAnalysis {
  /** The parsed rows, in source order; what the commit stores. */
  rows: W2wPlanRow[];
  report: PlanMatchReport;
  /** Per-row parse oddities, already worded for display. */
  issues: string[];
  /** Rows that arrived carrying an employee name. */
  assignedRowCount: number;
  /** Map rows to persist on commit, when this database has no mapping yet. */
  mapSeed: W2wPositionMapEntry[];
  /** The template's names as schedule rows, plus who could not be placed. */
  run: PlanRunBuild;
  /**
   * Hours of every block the plan matched. A row matches on its exact start
   * and end, so the row's own minutes are the block's.
   */
  blockSpans: Map<string, { start: number; end: number }>;
  /** Roster facts for scoring the transcribed run, keyed by email. */
  studentFacts: Map<string, PlanStudentFacts>;
}

export type PlanAnalysisResult =
  | { ok: true; analysis: PlanAnalysis }
  | { ok: false; error: string };

export async function analyzePlanUpload(
  bytes: Uint8Array,
  rotationWeek: "a" | "b",
): Promise<PlanAnalysisResult> {
  const parsed = parseW2wPlan(decodeCp1252(bytes));
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  const db = getDb();
  const inputs = await loadPlanMatchInputs();
  // First use on a database that never ran db:seed (prod deploys run only
  // migrations): match against the known mapping so the report is not inert,
  // skipping entries whose Muster position this database does not have. The
  // rows ride out to the commit, which is where they are written.
  const mapSeed =
    inputs.map.length === 0
      ? W2W_POSITION_MAP_SEED.filter((m) => inputs.positionNames.has(m.musterPositionId)).map(
          (m) => ({ ...m }),
        )
      : [];
  const report = matchPlan(parsed.rows, mapSeed.length > 0 ? mapSeed : inputs.map, inputs.blocks);

  const [mappedRows, rosterRows, positionRows, internalByEmail] = await Promise.all([
    db.select({ email: w2wEmployees.email, name: w2wEmployees.w2wName }).from(w2wEmployees),
    // Current roster only: a name on the plan must not resolve to somebody who
    // has left, and somebody who has left is not schedulable either way. They
    // stay reachable through the W2W name mapping above, which is what lets
    // the report say "off the roster" instead of "nobody by that name".
    db
      .select({
        email: students.email,
        displayName: students.displayName,
        positionId: students.positionId,
        international: students.international,
        everyWeekendOptIn: submissions.everyWeekendOptIn,
        desiredHours: submissions.desiredHours,
      })
      .from(students)
      .leftJoin(submissions, eq(submissions.studentEmail, students.email))
      .where(onRosterStudent()),
    db
      .select({ id: positions.id, minHours: positions.minHours, minDays: positions.minDays })
      .from(positions),
    loadInternalCopiesByEmail(),
  ]);

  const emailByName = buildNameIndex(
    mappedRows,
    rosterRows.map((r) => ({ name: deriveW2wName(r.displayName), email: r.email })),
  );
  const run = buildPlanRunAssignments(
    report.rows,
    emailByName,
    new Map(
      rosterRows.map((r) => [
        r.email,
        {
          // The effective rotation (PLAN §10a), not the student's answer: an
          // admin's internal copy replaces it in both directions, so a copy
          // set to alternating overrides a student who asked for every
          // weekend just as it does the other way round.
          everyWeekendOptIn: effectiveRotation(
            internalByEmail.get(r.email)?.everyWeekendOptIn,
            r.everyWeekendOptIn,
          ),
        },
      ]),
    ),
    rotationWeek,
  );

  const positionById = new Map(positionRows.map((p) => [p.id, p]));
  const blockSpans = new Map<string, { start: number; end: number }>();
  for (const row of report.rows) {
    if (row.matchedBlockId !== null) {
      blockSpans.set(row.matchedBlockId, { start: row.startMinutes, end: row.endMinutes });
    }
  }

  return {
    ok: true,
    analysis: {
      rows: parsed.rows,
      report,
      issues: parsed.issues.map((i) => `Row ${i.row}: ${i.message}`),
      assignedRowCount: parsed.rows.filter((r) => r.employeeName !== "").length,
      mapSeed,
      run,
      blockSpans,
      studentFacts: new Map(
        rosterRows.map((r) => {
          const position = r.positionId === null ? undefined : positionById.get(r.positionId);
          return [
            r.email,
            {
              international: r.international,
              desiredHours: r.desiredHours,
              minHours: position?.minHours ?? null,
              minDays: position?.minDays ?? null,
            },
          ];
        }),
      ),
    },
  };
}
