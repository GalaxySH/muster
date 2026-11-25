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
import { STALE_TERM_MESSAGE } from "@/lib/auth/require-admin";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { currentTermId, workingTermId } from "@/lib/terms/working";
import { resolveStudentAccess } from "./data";
import { NO_GROUP_MESSAGE, SUBMITTED_LOCK_MESSAGE, lockedReasonLine } from "./window-message";

export type StudentGate =
  | { ok: true; email: string; positionId: string | null; onBehalf: boolean; termId: string }
  | { ok: false; error: string };

/**
 * `renderedTermId` is the semester the admin's page was showing. It is needed
 * only on behalf of someone: the same person is in every semester, so a tab
 * left on another one would otherwise write this semester's row for them.
 *
 * The gate resolves the term once (the working term on behalf of someone, the
 * current one for a person's own form) and hands it back as `termId`. The
 * action uses that for everything it reads and writes, so a semester started
 * while it runs cannot split it across two terms.
 */
export async function requireEditableStudent(
  onBehalfOf?: string,
  renderedTermId?: string,
): Promise<StudentGate> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  // A person's own form is always the current semester's, also for an admin
  // who has another one selected. The selection is for the admin console and
  // for acting on someone's behalf.
  const target = onBehalfOf?.trim();
  const termId = target ? await workingTermId() : await currentTermId();
  if (target) {
    if (!session.isAdmin) {
      return { ok: false, error: "Only admins can fill in the form for someone else." };
    }
    if (!renderedTermId || renderedTermId !== termId) {
      return { ok: false, error: STALE_TERM_MESSAGE };
    }
    const employee = await findStudentByEmail(target, termId);
    if (!employee) return { ok: false, error: "That employee is not a known student." };
    return {
      ok: true,
      email: employee.email,
      positionId: employee.positionId,
      onBehalf: true,
      termId,
    };
  }

  const student = await findStudentByEmail(session.email, termId);
  if (!student) return { ok: false, error: "You are not on the roster." };

  const access = await resolveStudentAccess(student.email, termId);
  if (access.access === "no-group") return { ok: false, error: NO_GROUP_MESSAGE };
  if (!access.canEdit) {
    return {
      ok: false,
      error: access.lockedAfterSubmit
        ? SUBMITTED_LOCK_MESSAGE
        : lockedReasonLine(access.state, access.opensAt, access.closesAt),
    };
  }
  return {
    ok: true,
    email: student.email,
    positionId: student.positionId,
    onBehalf: false,
    termId,
  };
}
