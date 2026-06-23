/**
 * Server-side state for the student hub (/me) and the guided wizard (PLAN §4, §18b).
 * Resolves the two access gates (group membership + window) and infers where the
 * student is in the flow from persisted data — there is no progress column.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { loadStudentForm } from "@/lib/availability/data";
import { resolveStudentAccess } from "@/lib/groups/data";
import { validateAvailability } from "@/lib/domain/validation";
import { type WindowState } from "@/lib/domain/window";
import { POSITIONS } from "@/lib/config/positions";
import { flowStatus, type FlowStatus } from "./steps";

export type FlowAccess =
  | { kind: "no-group" }
  | {
      kind: "windowed";
      state: WindowState;
      opensAt: Date | null;
      closesAt: Date | null;
      canEdit: boolean;
      /** Editing blocked because the student already submitted (group locks it). */
      lockedAfterSubmit: boolean;
    };

export type FlowState =
  | { onRoster: false }
  | {
      onRoster: true;
      displayName: string;
      positionId: string | null;
      positionName: string | null;
      international: boolean;
      access: FlowAccess;
      status: FlowStatus;
    };

const positionName = (id: string | null) => POSITIONS.find((p) => p.id === id)?.name ?? null;

export async function loadFlowState(email: string): Promise<FlowState> {
  const form = await loadStudentForm(email);
  if (!form) return { onRoster: false };

  const accessRaw = await resolveStudentAccess(email);
  const access: FlowAccess =
    accessRaw.access === "no-group"
      ? { kind: "no-group" }
      : {
          kind: "windowed",
          state: accessRaw.state,
          opensAt: accessRaw.opensAt,
          closesAt: accessRaw.closesAt,
          canEdit: accessRaw.canEdit,
          lockedAfterSubmit: accessRaw.lockedAfterSubmit,
        };

  const [sub] = await getDb()
    .select({ courseScheduleFileId: submissions.courseScheduleFileId })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);

  const submitted = form.submission?.status === "submitted";
  const hasSubmissionRow = form.submission !== null;
  const hasCourseSchedule = Boolean(sub?.courseScheduleFileId);

  let availabilityComplete = false;
  if (form.position && form.submission && form.submission.desiredHours !== null) {
    const v = validateAvailability(form.selection, form.position, form.blocks, {
      everyWeekendOptIn: form.submission.everyWeekendOptIn,
    });
    availabilityComplete = v.canSubmit;
  }

  return {
    onRoster: true,
    displayName: form.student.displayName,
    positionId: form.student.positionId,
    positionName: positionName(form.student.positionId),
    international: form.student.international,
    access,
    status: flowStatus({ submitted, hasSubmissionRow, hasCourseSchedule, availabilityComplete }),
  };
}
