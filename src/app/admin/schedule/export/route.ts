/**
 * Admin-only CSV of the current recommended schedule: one row per assignment,
 * sorted by student, day, start time. BOM-prefixed so Excel reads the UTF-8.
 * The matrix itself is the shared builder the Muster Schedule sheet also uses.
 */
import { getAppSession } from "@/lib/auth/session";
import { loadCurrentSchedule } from "@/lib/schedule/data";
import { buildScheduleMatrix } from "@/lib/schedule/export";
import { toCsv } from "@/lib/admin/export";

const BOM = String.fromCharCode(0xfeff); // UTF-8 BOM for Excel

export async function GET() {
  const session = await getAppSession();
  if (!session?.isAdmin) return new Response("Forbidden", { status: 403 });

  const schedule = await loadCurrentSchedule();
  if (!schedule) return new Response("No schedule has been generated yet.", { status: 404 });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(BOM + toCsv(buildScheduleMatrix(schedule.students)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="muster-schedule-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
