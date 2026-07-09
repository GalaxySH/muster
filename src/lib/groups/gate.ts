/**
 * Shared gate for student-facing server actions (PLAN.md §13): session →
 * roster row → the two access gates (group membership, window state) plus the
 * post-submit lock. Availability, evidence, and close-claim mutations all
 * funnel through this so the access rules live in exactly one place.
 */
import "server-only";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { resolveStudentAccess } from "./data";
import {
  NO_GROUP_MESSAGE,
  SUBMITTED_LOCK_MESSAGE,
  lockedReasonLine,
} from "./window-message";

export type StudentGate =
  | { ok: true; email: string; positionId: string | null }
  | { ok: false; error: string };

export async function requireEditableStudent(): Promise<StudentGate> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  const student = await findStudentByEmail(session.email);
  if (!student) return { ok: false, error: "You are not on the roster." };

  const access = await resolveStudentAccess(student.email);
  if (access.access === "no-group") return { ok: false, error: NO_GROUP_MESSAGE };
  if (!access.canEdit) {
    return {
      ok: false,
      error: access.lockedAfterSubmit
        ? SUBMITTED_LOCK_MESSAGE
        : lockedReasonLine(access.state, access.opensAt, access.closesAt),
    };
  }
  return { ok: true, email: student.email, positionId: student.positionId };
}
