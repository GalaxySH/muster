"use server";

/**
 * Admin actions for the W2W shift-plan round-trip
 * (docs/w2w-shift-plan-roundtrip.md §10). The uploaded export is parsed in
 * memory and never written to disk, matching the roster-import idiom.
 *
 * The plan import itself lives in `lib/admin/plan-import-actions.ts`: it can
 * now write a schedule run from the template's names, and only the console may
 * compose W2W with the generator.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { shiftPlans, w2wEmployees } from "@/lib/db/schema";
import { decodeCp1252 } from "@/lib/text/cp1252";
import { parseW2wEmployees } from "@/lib/domain/w2w-plan/identity";
import { validateW2wCsvUpload } from "./upload-validation";

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
