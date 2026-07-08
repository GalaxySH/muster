/**
 * Admin-only CSV export of all responses (PLAN.md §10): the same matrix that
 * backs the running Drive sheet, downloaded on demand. Prefixed with a BOM so
 * Excel reads the UTF-8 (en-dashes in shift times etc.) correctly.
 */
import { getAppSession } from "@/lib/auth/session";
import { loadExportData } from "@/lib/admin/export-data";
import { buildExportMatrix, toCsv } from "@/lib/admin/export";

const BOM = String.fromCharCode(0xfeff); // UTF-8 BOM for Excel

export async function GET() {
  const session = await getAppSession();
  if (!session?.isAdmin) return new Response("Forbidden", { status: 403 });

  const csv = toCsv(buildExportMatrix(await loadExportData()));
  const date = new Date().toISOString().slice(0, 10);

  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="muster-responses-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
