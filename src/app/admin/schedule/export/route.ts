/**
 * Admin-only CSV of the current recommended schedule: one row per assignment,
 * sorted by student, day, start time. BOM-prefixed so Excel reads the UTF-8.
 */
import { getAppSession } from "@/lib/auth/session";
import { loadCurrentSchedule } from "@/lib/schedule/data";
import { toCsv } from "@/lib/admin/export";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL } from "@/lib/domain/types";

const BOM = String.fromCharCode(0xfeff); // UTF-8 BOM for Excel

const ROTATION_LABEL = {
  weekday: "",
  a: "A",
  b: "B",
  every: "Every weekend",
} as const;

export async function GET() {
  const session = await getAppSession();
  if (!session?.isAdmin) return new Response("Forbidden", { status: 403 });

  const schedule = await loadCurrentSchedule();
  if (!schedule) return new Response("No schedule has been generated yet.", { status: 404 });

  const matrix: string[][] = [
    ["Student", "Email", "Position", "Day", "Shift", "Rotation", "Marked scheduled"],
  ];
  for (const s of schedule.students) {
    for (const cell of s.cells) {
      matrix.push([
        s.displayName,
        s.email,
        s.positionName ?? "",
        DAY_LABEL[cell.day],
        formatSpan(cell.start, cell.end),
        ROTATION_LABEL[cell.cohort],
        s.scheduled ? "yes" : "no",
      ]);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(BOM + toCsv(matrix), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="muster-schedule-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
