"use server";

/**
 * On-demand fetch behind the one-student schedule popup (modal and hover
 * card). Same shape as fetchCellAvailability: admin-gated, ok/error result,
 * loaded only when an admin actually opens it.
 */
import { requireAdmin } from "@/lib/auth/require-admin";
import { loadStudentScheduleView, type StudentScheduleView } from "./student-schedule-data";

export type StudentScheduleResult =
  | { ok: true; data: StudentScheduleView }
  | { ok: false; error: string };

export async function fetchStudentSchedule(email: string): Promise<StudentScheduleResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const lookup = await loadStudentScheduleView(email);
  if (lookup.kind === "no-run") return { ok: false, error: "No schedule has been generated yet." };
  if (lookup.kind === "unknown-student") return { ok: false, error: "Unknown student." };
  return { ok: true, data: lookup.view };
}
