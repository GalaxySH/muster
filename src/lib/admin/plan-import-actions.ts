"use server";

/**
 * Admin action for the W2W shift-plan import
 * (docs/w2w-shift-plan-roundtrip.md §10).
 *
 * It lives in the console because one import can now touch two modules: W2W
 * analyses and stores the plan, and the generator writes the run the
 * template's assigned names become. W2W and the generator may not import each
 * other, and the console is the layer allowed to compose them.
 *
 * Two phases, one path. Without `confirm` the action analyses the upload and
 * returns what it would do, writing nothing; the confirmed call re-reads the
 * same file and analyses it again. The browser therefore never decides what
 * gets written, only whether to go ahead.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { shiftPlans, shiftPlanRows, w2wPositionMap } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { DESIRED_CAPACITY_MAX } from "@/lib/domain/config-validation";
import { CapacityRefused, setBlockCapacities } from "@/lib/positions/capacity";
import { EPSILON_MINUTES, formatSpan } from "@/lib/domain/time";
import { weekMinutesForRows, type ExistingAssignment } from "@/lib/domain/scheduling/manual";
import { targetMinutes } from "@/lib/domain/scheduling/seats";
import { weekendCohortOf, type StoredRunReport } from "@/lib/domain/scheduling/types";
import type { PlanRunBuild } from "@/lib/domain/w2w-plan/repair-seeds";
import { writeRunAsCurrent } from "@/lib/schedule/run-write";
import { analyzePlanUpload, type PlanAnalysis, type PlanStudentFacts } from "@/lib/w2w/plan-import";
import { validateW2wCsvUpload } from "@/lib/w2w/upload-validation";
import { SCHEDULE_SHEET, trySyncSheet } from "./sheet-sync";

/** A list the screen shows the head of, with the count it was cut from. */
export interface CappedList {
  total: number;
  sample: string[];
}

/** What the confirmation screen shows. Kept small: a week is ~1000 rows. */
export interface PlanImportPreview {
  rowCount: number;
  matchedCount: number;
  assignedRowCount: number;
  /** Shifts no Muster block matches, and the shapes they group into. */
  unmatchedRowCount: number;
  unmatched: CappedList;
  unknownPositions: CappedList;
  /** Blocks whose staffing target the checkbox would change. */
  capacityChanges: number;
  issues: CappedList;
  /** Whether the upload was asked to replace the schedule. */
  createRun: boolean;
  run: {
    assignments: number;
    students: number;
    /** Names on the plan that no single student answers to. */
    unassociated: CappedList;
    /** Names belonging to someone who is no longer on the roster. */
    offRoster: CappedList;
    /** Roster students this plan gives no shift. */
    noAssignments: CappedList;
  };
}

export interface PlanImportResult {
  ok: boolean;
  error?: string;
  /** What the upload would do; returned by both phases. */
  preview?: PlanImportPreview;
  /** Present only once the import was confirmed and written. */
  applied?: {
    capacityUpdated: number;
    /** Assignment rows the new run holds, or null when no run was made. */
    runAssignments: number | null;
  };
}

/** Insert chunk size: one week is ~1000 rows; keep statements comfortably small. */
const ROW_CHUNK = 200;

/** How many names each delta list shows before it is just a count. */
const LIST_CAP = 20;

export async function importShiftPlanFromUpload(formData: FormData): Promise<PlanImportResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was provided." };
  const check = validateW2wCsvUpload({ name: file.name, size: file.size });
  if (!check.ok) return { ok: false, error: check.error ?? "Invalid file." };

  const rotationRaw = formData.get("rotationWeek");
  if (rotationRaw !== "a" && rotationRaw !== "b") {
    return { ok: false, error: "Pick which weekend rotation this export is (week A or B)." };
  }
  const applyCapacity = formData.get("applyCapacity") === "1";
  const createRun = formData.get("createRun") === "1";

  const analyzed = await analyzePlanUpload(new Uint8Array(await file.arrayBuffer()), rotationRaw);
  if (!analyzed.ok) return { ok: false, error: analyzed.error };
  const analysis = analyzed.analysis;
  const preview = toPreview(analysis, createRun);

  if (formData.get("confirm") !== "1") return { ok: true, preview };

  const planId = randomUUID();
  let capacityUpdated = 0;
  try {
    await getDb().transaction(async (tx) => {
      if (analysis.mapSeed.length > 0) {
        await tx.insert(w2wPositionMap).values(analysis.mapSeed);
      }
      await tx
        .update(shiftPlans)
        .set({ status: "superseded" })
        .where(eq(shiftPlans.status, "current"));
      await tx.insert(shiftPlans).values({
        id: planId,
        importedBy: gate.email,
        sourceFilename: file.name,
        rowCount: analysis.rows.length,
        rotationWeek: rotationRaw,
      });
      for (let at = 0; at < analysis.rows.length; at += ROW_CHUNK) {
        await tx.insert(shiftPlanRows).values(
          analysis.rows.slice(at, at + ROW_CHUNK).map((r) => ({
            planId,
            seq: r.seq,
            w2wPositionId: r.w2wPositionId,
            w2wPositionName: r.w2wPositionName,
            category: r.category,
            description: r.description,
            day: r.day,
            startTime: r.startTime,
            endTime: r.endTime,
            duration: r.duration,
            startMinutes: r.startMinutes,
            endMinutes: r.endMinutes,
            importedEmployeeName: r.employeeName,
            importedEmployeeNumber: r.employeeNumber,
          })),
        );
      }
      if (applyCapacity) {
        // Target staffing is position config, so it is written through the
        // seam the positions module owns rather than straight into the table.
        // That is also what checks the plan's seat counts are in range.
        capacityUpdated = await setBlockCapacities(
          tx,
          analysis.report.capacity
            .filter((line) => line.desiredCapacity !== line.planSeats)
            .map((line) => ({ blockId: line.blockId, desiredCapacity: line.planSeats })),
        );
      }
      if (createRun) {
        await writeRunAsCurrent(tx, {
          assignments: analysis.run.assignments,
          report: planRunReport(analysis.run, analysis.studentFacts, analysis.blockSpans),
          generatedBy: gate.email,
          // Nothing was solved here, only transcribed. The scope ledger counts
          // a generated run as a re-solve of the slice it names.
          kind: "snapshot",
          // The whole roster: a transcription is never a slice.
          scopeJson: null,
        });
      }
    });
  } catch (e) {
    if (e instanceof CapacityRefused) {
      return {
        ok: false,
        error: `A shift in the plan asks for ${e.target.desiredCapacity} people. Target staffing has to be a whole number from 1 to ${DESIRED_CAPACITY_MAX}. Nothing was imported.`,
      };
    }
    console.error("Shift plan import failed:", e);
    return { ok: false, error: "Could not save the plan. Please try again." };
  }

  revalidatePath("/admin/schedule/plan");
  revalidatePath("/admin/w2w");
  // Capacity targets feed the coverage view and the generator's seat math; a
  // new run is the schedule itself.
  if (capacityUpdated > 0 || createRun) revalidatePath("/admin/schedule");
  if (createRun) {
    revalidatePath("/admin");
    await trySyncSheet(SCHEDULE_SHEET, 0);
  }

  return {
    ok: true,
    preview,
    applied: {
      capacityUpdated,
      runAssignments: createRun ? analysis.run.assignments.length : null,
    },
  };
}

const capped = (lines: string[]): CappedList => ({
  total: lines.length,
  sample: lines.slice(0, LIST_CAP),
});

function toPreview(analysis: PlanAnalysis, createRun: boolean): PlanImportPreview {
  const { report, run } = analysis;
  return {
    rowCount: analysis.rows.length,
    matchedCount: report.matchedCount,
    assignedRowCount: analysis.assignedRowCount,
    unmatchedRowCount: report.unmatched.reduce((n, u) => n + u.rowCount, 0),
    unmatched: capped(
      report.unmatched.map((u) =>
        [
          u.w2wPositionName,
          u.dayType === "weekday" ? "weekday" : "weekend",
          formatSpan(u.startMinutes, u.endMinutes),
          u.description,
          `${u.rowCount} shift${u.rowCount === 1 ? "" : "s"}`,
        ]
          .filter((part) => part !== "")
          .join(" · "),
      ),
    ),
    unknownPositions: capped(
      report.unknownPositions.map((p) => `${p.w2wPositionName} (${p.w2wPositionId})`),
    ),
    capacityChanges: report.capacity.filter((l) => l.desiredCapacity !== l.planSeats).length,
    issues: capped(analysis.issues),
    createRun,
    run: {
      assignments: run.assignments.length,
      students: new Set(run.assignments.map((a) => a.studentEmail)).size,
      unassociated: capped(
        run.unassociatedNames.map(
          (u) => `${u.name} (${u.reason === "ambiguous" ? "more than one match" : "no match"})`,
        ),
      ),
      offRoster: capped(run.skippedOffRoster.map((o) => `${o.name} (${o.email})`)),
      noAssignments: capped(run.studentsWithNoAssignments),
    },
  };
}

/**
 * The report a transcribed run stores. The run-history reader parses this and
 * reads `students` and `shortOfTarget` off it, and the schedule page derives
 * its headline counts from `assignedMinutes` rather than from the rows, so
 * every field a reader touches has to carry a real number.
 *
 * Nothing was solved here, but the students and their hours are still facts:
 * hours are measured with the engine's own `weekMinutesForRows` (covered-hours
 * union, weekend rows cycle-averaged) and the goal with its own
 * `targetMinutes`, so "short of hours" means the same thing on an imported run
 * as on a generated one and says which people the template under-books.
 * `stats` stays absent, the way a cleared run's does: those are health figures
 * of a solve that never happened. `origin` is what says so.
 */
function planRunReport(
  run: PlanRunBuild,
  facts: ReadonlyMap<string, PlanStudentFacts>,
  spans: ReadonlyMap<string, { start: number; end: number }>,
): StoredRunReport {
  const rowsByEmail = new Map<string, ExistingAssignment[]>();
  for (const a of run.assignments) {
    const span = spans.get(a.blockId);
    if (!span) continue;
    const list = rowsByEmail.get(a.studentEmail) ?? [];
    list.push({ blockId: a.blockId, day: a.day, cohort: a.cohort, ...span });
    rowsByEmail.set(a.studentEmail, list);
  }

  const students = [...rowsByEmail].map(([email, rows]) => {
    const fact = facts.get(email);
    return {
      email,
      // No position means no floor and no goal, the same zero the engine
      // reports for a student it cannot target.
      targetMinutes:
        fact && fact.minHours !== null
          ? targetMinutes(
              { desiredHours: fact.desiredHours, international: fact.international },
              { minHours: fact.minHours },
            )
          : 0,
      assignedMinutes: weekMinutesForRows(rows),
      daysUsed: new Set(rows.map((r) => r.day)).size,
      cohort: weekendCohortOf(rows),
      frozen: false,
    };
  });

  return {
    students,
    // A transcription drops nobody and skips nobody: it writes exactly the
    // seats the template named and reports the rest rather than swallowing it.
    droppedStudents: [],
    droppedBlockGone: 0,
    skippedNoPosition: [],
    shortOfTarget: students.filter((s) => s.assignedMinutes + EPSILON_MINUTES < s.targetMinutes)
      .length,
    belowMinDays: students.filter((s) => {
      const minDays = facts.get(s.email)?.minDays ?? null;
      return minDays !== null && s.daysUsed < minDays;
    }).length,
    origin: "w2w-plan",
  };
}
