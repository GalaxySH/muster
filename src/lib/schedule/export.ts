/**
 * Pure builder for the recommended-schedule matrix: one row per assignment,
 * shared by the CSV route (/admin/schedule/export) and the `Muster Schedule`
 * Drive sheet (admin/sheet-sync.ts). Mirrors the responses/closes export split:
 * pure builder here, server loader feeds it.
 */
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL, type Day } from "@/lib/domain/types";
import type { Cohort } from "@/lib/domain/scheduling/types";

/** One student's row as the matrix consumes it (ScheduleStudentRow satisfies it). */
export interface ScheduleExportRow {
  displayName: string;
  email: string;
  positionName: string | null;
  scheduled: boolean;
  cells: readonly { day: Day; start: number; end: number; cohort: Cohort }[];
}

export const SCHEDULE_EXPORT_HEADERS = [
  "Student",
  "Email",
  "Position",
  "Day",
  "Shift",
  "Rotation",
  "Marked scheduled",
] as const;

const ROTATION_LABEL: Record<Cohort, string> = {
  weekday: "",
  a: "A",
  b: "B",
  every: "Every weekend",
};

/** Build the schedule matrix: header row + one row per assigned cell. */
export function buildScheduleMatrix(students: readonly ScheduleExportRow[]): string[][] {
  const matrix: string[][] = [[...SCHEDULE_EXPORT_HEADERS]];
  for (const s of students) {
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
  return matrix;
}
