import "server-only";

/**
 * Build the filled W2W export and its warnings
 * (docs/w2w-shift-plan-roundtrip.md §3, §7). Everything is computed live from
 * the stored raw plan, the current run, and the current identity mapping, so
 * the warnings shown next to the download buttons always describe the file
 * that would download right now.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { scheduleAssignments, students, w2wEmployees } from "@/lib/db/schema";
import { onRosterStudent } from "@/lib/roster/lookup";
import { loadCurrentRunRow } from "@/lib/schedule/data";
import { matchPlan } from "@/lib/domain/w2w-plan/match";
import { deriveW2wName } from "@/lib/domain/w2w-plan/identity";
import { buildNameIndex } from "@/lib/domain/w2w-plan/repair-seeds";
import {
  droppedImportedNames,
  fillPlan,
  type DroppedName,
  type ExportIdentity,
  type FillAssignment,
  type FillResult,
  type WeekFile,
} from "@/lib/domain/w2w-plan/fill";
import { serializeW2wUpload } from "@/lib/domain/w2w-plan/serialize";
import { isCp1252Lossy } from "@/lib/text/cp1252";
import { getCurrentPlan, loadPlanMatchInputs, type PlanMeta } from "./plan-data";

export interface ExportWarnings {
  /** Students the run schedules onto cells with no seat left (or none at all). */
  overflow: { email: string; displayName: string; blockLabel: string }[];
  /** Students exported under a roster-derived name W2W may not recognize. */
  fallback: { email: string; name: string }[];
  /** Names the Windows-1252 file cannot hold exactly; W2W will not match them. */
  lossyNames: { email: string; name: string }[];
  /** Plan rows Muster cannot fill (no matching block); they export open. */
  unmatchedRowCount: number;
  /** Set when the plan changed after the run was generated; regenerate first. */
  planNewerThanRun: boolean;
  /** Students the plan gave shifts to who have none here (see droppedImportedNames). */
  droppedNames: DroppedName[];
}

export interface ExportModel {
  planMeta: PlanMeta;
  runGeneratedAt: Date;
  warnings: ExportWarnings;
  /** Filled rows per week file, ready to serialize. */
  files: Record<WeekFile, FillResult>;
}

export type ExportUnavailable = { reason: "no-plan" } | { reason: "no-run" };

/** Everything the export needs, or why it cannot run yet. */
export async function buildExportModel(): Promise<ExportModel | ExportUnavailable> {
  const plan = await getCurrentPlan();
  if (!plan) return { reason: "no-plan" };
  const run = await loadCurrentRunRow();
  if (!run) return { reason: "no-run" };

  const db = getDb();
  const [inputs, assignmentRows] = await Promise.all([
    loadPlanMatchInputs(),
    // On-roster only. This is the file the scheduler uploads into W2W, so a
    // student who left after the run was generated must not be given a shift in
    // it. The identity reads below all hang off these emails.
    db
      .select({
        studentEmail: scheduleAssignments.studentEmail,
        blockId: scheduleAssignments.shiftBlockId,
        day: scheduleAssignments.day,
        cohort: scheduleAssignments.cohort,
      })
      .from(scheduleAssignments)
      .innerJoin(students, eq(scheduleAssignments.studentEmail, students.email))
      .where(and(onRosterStudent(), eq(scheduleAssignments.runId, run.id))),
  ]);

  const report = matchPlan(plan.rows, inputs.map, inputs.blocks);
  const matchedByRow = report.rows.map((r) => r.matchedBlockId);

  // Export identity per assigned student: the W2W mapping wins; the roster
  // derivation covers the rest and is flagged on every use.
  const emails = [...new Set(assignmentRows.map((a) => a.studentEmail))];
  const [mapped, rosterRows] =
    emails.length === 0
      ? [[], []]
      : await Promise.all([
          db.select().from(w2wEmployees).where(inArray(w2wEmployees.email, emails)),
          db
            .select({ email: students.email, displayName: students.displayName })
            .from(students)
            .where(inArray(students.email, emails)),
        ]);
  const displayNames = new Map(rosterRows.map((s) => [s.email, s.displayName]));
  const identities = new Map<string, ExportIdentity>(
    emails.map((email) => {
      const hit = mapped.find((m) => m.email === email);
      if (hit) {
        return [email, { name: hit.w2wName, employeeNumber: hit.employeeNumber, derived: false }];
      }
      const display = displayNames.get(email);
      return [email, { name: deriveW2wName(display ?? email), employeeNumber: "", derived: true }];
    }),
  );

  const assignments: FillAssignment[] = assignmentRows;
  const files: Record<WeekFile, FillResult> = {
    a: fillPlan(plan.rows, matchedByRow, assignments, identities, inputs.map, "a"),
    b: fillPlan(plan.rows, matchedByRow, assignments, identities, inputs.map, "b"),
  };

  // Overflow is identical across week files for weekday cells; union the two
  // and label blocks readably for the warning list.
  const blockLabel = new Map(
    inputs.blocks.map((b) => [
      b.id,
      `${inputs.positionNames.get(b.positionId) ?? b.positionId} ${b.dayType}`,
    ]),
  );
  const overflowSeen = new Map<
    string,
    { email: string; displayName: string; blockLabel: string }
  >();
  for (const week of ["a", "b"] as const) {
    for (const o of files[week].overflow) {
      const key = `${o.studentEmail}|${o.blockId}|${o.day}`;
      if (overflowSeen.has(key)) continue;
      overflowSeen.set(key, {
        email: o.studentEmail,
        displayName: displayNames.get(o.studentEmail) ?? o.studentEmail,
        blockLabel: `${blockLabel.get(o.blockId) ?? o.blockId} (${o.day})`,
      });
    }
  }

  const fallbackEmails = [
    ...new Set([...files.a.fallbackEmails, ...files.b.fallbackEmails]),
  ].sort();

  // Who the export actually gives shifts to, across both week files: a weekend
  // student appears in only one of them, so the union is the right question to
  // ask of an imported name.
  const filledEmails = new Set<string>();
  for (const week of ["a", "b"] as const) {
    for (const row of files[week].rows) {
      if (row.filledEmail !== null) filledEmails.add(row.filledEmail);
    }
  }
  // Resolving imported names needs the whole roster and name list, so it is
  // skipped outright for a plan that arrived with no names on it. The roster
  // half is the CURRENT roster: a departed student left in it could absorb an
  // imported W2W name and silence the warning that the plan gave that person
  // shifts this export does not, or make the lookup ambiguous and silence it
  // that way instead.
  const hasImportedNames = plan.rows.some((r) => r.employeeName !== "");
  const [allNameRows, allRosterRows] = hasImportedNames
    ? await Promise.all([
        db.select({ email: w2wEmployees.email, name: w2wEmployees.w2wName }).from(w2wEmployees),
        db
          .select({ email: students.email, displayName: students.displayName })
          .from(students)
          .where(onRosterStudent()),
      ])
    : [[], []];
  const nameIndex = buildNameIndex(
    allNameRows.map((m) => ({ name: m.name, email: m.email })),
    allRosterRows.map((r) => ({ name: deriveW2wName(r.displayName), email: r.email })),
  );

  return {
    planMeta: plan.meta,
    runGeneratedAt: run.generatedAt,
    warnings: {
      overflow: [...overflowSeen.values()].sort(
        (x, y) => x.email.localeCompare(y.email) || x.blockLabel.localeCompare(y.blockLabel),
      ),
      fallback: fallbackEmails.map((email) => ({
        email,
        name: identities.get(email)?.name ?? email,
      })),
      lossyNames: [...identities.entries()]
        .filter(([, id]) => isCp1252Lossy(id.name))
        .map(([email, id]) => ({ email, name: id.name }))
        .sort((x, y) => x.email.localeCompare(y.email)),
      unmatchedRowCount: report.unmatched.reduce((n, u) => n + u.rowCount, 0),
      planNewerThanRun: plan.meta.importedAt > run.generatedAt,
      droppedNames: droppedImportedNames(plan.rows, filledEmails, nameIndex),
    },
    files,
  };
}

/** The downloadable CSV text for one week file. */
export function exportFileText(model: ExportModel, week: WeekFile): string {
  return serializeW2wUpload(model.files[week].rows);
}
