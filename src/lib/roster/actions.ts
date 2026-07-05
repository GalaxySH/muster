"use server";

/**
 * Admin roster-import action (PLAN.md §4.2): upload the PCPL workbook from
 * /admin/roster instead of running the CLI on the box. Admin-gated; the file
 * is validated, read into memory, and handed to the same importRoster
 * orchestrator the CLI uses (idempotent upsert — "People Coming" → on-roster,
 * "People Leaving" → off-roster). The workbook bytes are never written to disk.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getAppSession } from "@/lib/auth/session";
import { validateRosterUpload } from "./upload-validation";
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

  const workbook = Buffer.from(await file.arrayBuffer());
  try {
    const summary = await importRoster({
      db: getDb(),
      workbook,
      importedBy: session.email,
    });
    // The roster feeds every active-student surface — refresh them all.
    revalidatePath("/admin/roster");
    revalidatePath("/admin/responses");
    revalidatePath("/admin/non-responses");
    return { ok: true, summary };
  } catch (e) {
    console.error("Roster import failed:", e);
    // readPeopleComing throws admin-actionable messages (e.g. a missing
    // "People Coming" sheet); pass those through. Anything else gets a generic line.
    const message =
      e instanceof Error && e.message.includes("People Coming")
        ? e.message
        : "Could not read the workbook. Make sure it's the PCPL .xlsx file and try again.";
    return { ok: false, error: message };
  }
}
