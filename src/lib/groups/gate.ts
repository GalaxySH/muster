/**
 * Shared gate for student-facing server actions (PLAN.md §13): session →
 * roster row → the two access gates (group membership, window state) plus the
 * post-submit lock. Availability, evidence, and close-claim mutations all
 * funnel through this so the access rules live in exactly one place.
 *
 * An admin may instead act **on behalf of** a student (`onBehalfOf`), so a
 * scheduler can fill in details for someone who never filled the form in. That
 * path deliberately skips the window/lock gates (same call as the change-request
 * flow's `resolveTargetStudent`): the admin is the authority, not the window.
 */
import "server-only";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { resolveStudentAccess } from "./data";
import { NO_GROUP_MESSAGE, SUBMITTED_LOCK_MESSAGE, lockedReasonLine } from "./window-message";

export type StudentGate =
  | { ok: true; email: string; positionId: string | null; onBehalf: boolean }
  | { ok: false; error: string };

export async function requireEditableStudent(onBehalfOf?: string): Promise<StudentGate> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };

  const target = onBehalfOf?.trim();
  if (target) {
    if (!session.isAdmin) {
      return { ok: false, error: "Only admins can fill in the form for someone else." };
    }
    const employee = await findStudentByEmail(target);
    if (!employee) return { ok: false, error: "That employee is not a known student." };
    return { ok: true, email: employee.email, positionId: employee.positionId, onBehalf: true };
  }

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
  return { ok: true, email: student.email, positionId: student.positionId, onBehalf: false };
}
