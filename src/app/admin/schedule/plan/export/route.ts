/**
 * Download one week file of the filled W2W plan
 * (docs/w2w-shift-plan-roundtrip.md §3): ?week=a or ?week=b. Windows-1252
 * bytes, matching the W2W export the plan came from, so names with accents
 * survive the round trip.
 */
import { getAppSession } from "@/lib/auth/session";
import { buildExportModel, exportFileText } from "@/lib/w2w/export-data";
import { encodeCp1252 } from "@/lib/text/cp1252";

const UNAVAILABLE_MESSAGE = {
  "no-plan": "No shift plan has been imported yet.",
  "no-run": "No schedule has been generated yet.",
} as const;

export async function GET(req: Request) {
  const session = await getAppSession();
  if (!session?.isAdmin) return new Response("Forbidden", { status: 403 });

  const week = new URL(req.url).searchParams.get("week");
  if (week !== "a" && week !== "b") {
    return new Response("Pick week a or b.", { status: 400 });
  }

  const model = await buildExportModel();
  if ("reason" in model) {
    return new Response(UNAVAILABLE_MESSAGE[model.reason], { status: 404 });
  }

  const bytes = encodeCp1252(exportFileText(model, week));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "text/csv; charset=windows-1252",
      "Content-Disposition": `attachment; filename="muster-w2w-week-${week}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
