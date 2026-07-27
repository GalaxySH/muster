"use server";

/**
 * Admin roster-import action (PLAN.md §4.2): upload the roster tracker from
 * /admin/roster instead of running the CLI on the box. Admin-gated; the file
 * is validated, read into memory, and handed to the same importRoster
 * orchestrator the CLI uses (idempotent upsert, Status decides who is on the
 * roster). The file bytes are never written to disk.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getAppSession } from "@/lib/auth/session";
import { validateRosterUpload } from "./upload-validation";
import { RosterFormatError } from "./parse";
import { importRoster, type ImportSummary } from "./import";

export interface RosterImportResult {
  ok: boolean;
  error?: string;
  summary?: ImportSummary;
}

export async function importRosterFromUpload(formData: FormData): Promise<RosterImportResult> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  if (!session.isAdmin) return { ok: false, error: "Admins only." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was provided." };
  const check = validateRosterUpload({ name: file.name, type: file.type, size: file.size });
  if (!check.ok) return { ok: false, error: check.error ?? "Invalid file." };

  const sheetName = String(formData.get("sheetName") ?? "").trim();
  const allowMassDeactivation = formData.get("allowMassDeactivation") === "1";

  const workbook = Buffer.from(await file.arrayBuffer());
  try {
    const summary = await importRoster({
      db: getDb(),
      workbook,
      importedBy: session.email,
      sheetName: sheetName || undefined,
      allowMassDeactivation,
    });
    // The roster feeds every active-student surface; refresh them all.
    revalidatePath("/admin/roster");
    revalidatePath("/admin/responses");
    revalidatePath("/admin/non-responses");
    return { ok: true, summary };
  } catch (e) {
    console.error("Roster import failed:", e);
    // Format problems name the sheet or the missing column, so they're worth
    // showing verbatim; anything else gets a generic line.
    const message =
      e instanceof RosterFormatError
        ? e.message
        : "Could not read the file. Make sure it's the roster tracker (.xlsx or .csv) and try again.";
    return { ok: false, error: message };
  }
}
