"use server";

/**
 * Admin actions for the W2W shift-plan round-trip
 * (docs/w2w-shift-plan-roundtrip.md §10). The uploaded export is parsed in
 * memory and never written to disk, matching the roster-import idiom. A
 * refused parse persists nothing; a successful import supersedes the previous
 * plan the way schedule runs supersede each other.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { shiftPlans, shiftPlanRows, students, w2wEmployees, w2wPositionMap } from "@/lib/db/schema";
import { decodeCp1252 } from "@/lib/text/cp1252";
import { parseW2wPlan } from "@/lib/domain/w2w-plan/parse";
import { matchPlan } from "@/lib/domain/w2w-plan/match";
import { deriveW2wName, parseW2wEmployees } from "@/lib/domain/w2w-plan/identity";
import { DESIRED_CAPACITY_MAX } from "@/lib/domain/config-validation";
import { CapacityRefused, setBlockCapacities } from "@/lib/positions/capacity";
import { W2W_POSITION_MAP_SEED } from "./position-map-seed";
import { validateW2wCsvUpload } from "./upload-validation";
import { loadPlanMatchInputs } from "./plan-data";

export interface PlanImportResult {
  ok: boolean;
  error?: string;
  summary?: {
    rowCount: number;
    matchedCount: number;
    unmatchedRowCount: number;
    unknownPositionCount: number;
    /** Blocks whose desired capacity the checkbox changed. */
    capacityUpdated: number;
    /** Rows that arrived already carrying an employee name. */
    assignedRowCount: number;
    /** Imported names no mapping entry or roster derivation accounts for. */
    unknownImportedNames: string[];
    /** Per-row parse oddities worth showing (first few). */
    issues: string[];
  };
}

/** Insert chunk size: one week is ~1000 rows; keep statements comfortably small. */
const ROW_CHUNK = 200;

export async function importShiftPlanFromUpload(formData: FormData): Promise<PlanImportResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was provided." };
  const check = validateW2wCsvUpload({ name: file.name, size: file.size });
  if (!check.ok) return { ok: false, error: check.error ?? "Invalid file." };

  const applyCapacity = formData.get("applyCapacity") === "1";
  const rotationRaw = formData.get("rotationWeek");
  if (rotationRaw !== "a" && rotationRaw !== "b") {
    return { ok: false, error: "Pick which weekend rotation this export is (week A or B)." };
  }
  const rotationWeek = rotationRaw;

  const text = decodeCp1252(new Uint8Array(await file.arrayBuffer()));
  const parsed = parseW2wPlan(text);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  const db = getDb();
  let inputs = await loadPlanMatchInputs();
  // First use on a database that never ran db:seed (prod deploys run only
  // migrations): seed the known W2W position mapping so the import is not
  // inert, skipping rows whose Muster position this DB does not have.
  if (inputs.map.length === 0) {
    const seedRows = W2W_POSITION_MAP_SEED.filter((m) =>
      inputs.positionNames.has(m.musterPositionId),
    );
    if (seedRows.length > 0) {
      await db.insert(w2wPositionMap).values([...seedRows]);
      inputs = await loadPlanMatchInputs();
    }
  }
  const report = matchPlan(parsed.rows, inputs.map, inputs.blocks);

  // Names riding in on the file that nothing can place: not in the W2W name
  // mapping and not the derived name of anyone on the roster.
  const importedNames = [
    ...new Set(parsed.rows.map((r) => r.employeeName).filter((n) => n !== "")),
  ];
  let unknownImportedNames: string[] = [];
  if (importedNames.length > 0) {
    const [mappedNames, rosterNames] = await Promise.all([
      db.select({ name: w2wEmployees.w2wName }).from(w2wEmployees),
      db.select({ displayName: students.displayName }).from(students),
    ]);
    const known = new Set(mappedNames.map((m) => m.name));
    for (const s of rosterNames) known.add(deriveW2wName(s.displayName));
    unknownImportedNames = importedNames.filter((n) => !known.has(n)).sort();
  }
  const planId = randomUUID();
  let capacityUpdated = 0;
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(shiftPlans)
        .set({ status: "superseded" })
        .where(eq(shiftPlans.status, "current"));
      await tx.insert(shiftPlans).values({
        id: planId,
        importedBy: gate.email,
        sourceFilename: file.name,
        rowCount: parsed.rows.length,
        rotationWeek,
      });
      for (let at = 0; at < parsed.rows.length; at += ROW_CHUNK) {
        await tx.insert(shiftPlanRows).values(
          parsed.rows.slice(at, at + ROW_CHUNK).map((r) => ({
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
          report.capacity
            .filter((line) => line.desiredCapacity !== line.planSeats)
            .map((line) => ({ blockId: line.blockId, desiredCapacity: line.planSeats })),
        );
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
  // Capacity targets feed the coverage view and the generator's seat math.
  if (capacityUpdated > 0) revalidatePath("/admin/schedule");

  const unmatchedRowCount = report.unmatched.reduce((n, u) => n + u.rowCount, 0);
  return {
    ok: true,
    summary: {
      rowCount: parsed.rows.length,
      matchedCount: report.matchedCount,
      unmatchedRowCount,
      unknownPositionCount: report.unknownPositions.length,
      capacityUpdated,
      assignedRowCount: parsed.rows.filter((r) => r.employeeName !== "").length,
      unknownImportedNames: unknownImportedNames.slice(0, 10),
      issues: parsed.issues.slice(0, 5).map((i) => `Row ${i.row}: ${i.message}`),
    },
  };
}

/**
 * Correct which weekend rotation the current plan represents. It is picked at
 * upload and decides the cohort a weekend name resolves to in repair mode, so
 * getting it wrong flips the rotation of every weekend student who is not an
 * every-weekend opt-in. Re-uploading the file to fix one radio button would
 * supersede the plan and throw away the row set for no reason.
 */
export async function setPlanRotationWeek(
  planId: string,
  rotationWeek: "a" | "b",
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (rotationWeek !== "a" && rotationWeek !== "b") {
    return { ok: false, error: "Pick week A or week B." };
  }

  // Checked directly rather than through affectedRows, which counts CHANGED
  // rows: setting the rotation it already has would otherwise look like the
  // plan had been superseded, and re-uploading to "fix" that throws away a
  // perfectly good plan.
  const db = getDb();
  const [current] = await db
    .select({ id: shiftPlans.id })
    .from(shiftPlans)
    .where(and(eq(shiftPlans.id, planId), eq(shiftPlans.status, "current")))
    .limit(1);
  if (!current) return { ok: false, error: "That plan is no longer the current one." };

  await db.update(shiftPlans).set({ rotationWeek }).where(eq(shiftPlans.id, planId));

  revalidatePath("/admin/schedule/plan");
  revalidatePath("/admin/w2w");
  return { ok: true };
}

export interface EmployeesImportResult {
  ok: boolean;
  error?: string;
  summary?: { total: number; added: number; updated: number; removed: number; skipped: number };
}

/**
 * Refresh the email-keyed W2W name mapping from the Employee Details export.
 * The table becomes an exact mirror of the file: names W2W no longer lists
 * are removed so the export never writes a name W2W would not recognize.
 */
export async function importW2wEmployeesFromUpload(
  formData: FormData,
): Promise<EmployeesImportResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was provided." };
  const check = validateW2wCsvUpload({ name: file.name, size: file.size });
  if (!check.ok) return { ok: false, error: check.error ?? "Invalid file." };

  const text = decodeCp1252(new Uint8Array(await file.arrayBuffer()));
  const parsed = parseW2wEmployees(text);
  if (!parsed.ok) return { ok: false, error: parsed.reason ?? "Could not read the file." };

  const db = getDb();
  try {
    const before = new Map(
      (await db.select().from(w2wEmployees)).map((e) => [
        e.email,
        { w2wName: e.w2wName, employeeNumber: e.employeeNumber },
      ]),
    );
    let added = 0;
    let updated = 0;
    for (const e of parsed.employees) {
      const prev = before.get(e.email);
      if (!prev) added += 1;
      else if (prev.w2wName !== e.w2wName || prev.employeeNumber !== e.employeeNumber) updated += 1;
    }
    const removed = [...before.keys()].filter(
      (email) => !parsed.employees.some((e) => e.email === email),
    ).length;

    await db.transaction(async (tx) => {
      await tx.delete(w2wEmployees);
      await tx.insert(w2wEmployees).values(
        parsed.employees.map((e) => ({
          email: e.email,
          w2wName: e.w2wName,
          employeeNumber: e.employeeNumber,
        })),
      );
    });

    revalidatePath("/admin/schedule/plan");
    return {
      ok: true,
      summary: { total: parsed.employees.length, added, updated, removed, skipped: parsed.skipped },
    };
  } catch (e) {
    console.error("W2W employee import failed:", e);
    return { ok: false, error: "Could not save the employee list. Please try again." };
  }
}
