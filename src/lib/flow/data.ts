/**
 * Server-side state for the student hub (/me) and the guided wizard (PLAN §4, §18b).
 * Resolves the two access gates (group membership + window) and infers where the
 * student is in the flow from persisted data; there is no progress column.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { loadStudentForm } from "@/lib/availability/data";
import { resolveStudentAccess } from "@/lib/groups/data";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { type WindowState } from "@/lib/domain/window";
import { POSITIONS } from "@/lib/config/positions";
import { flowStatus, reachableStepKeys, type FlowInputs, type FlowStatus, type WizardStepKey } from "./steps";

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

type LoadedForm = NonNullable<Awaited<ReturnType<typeof loadStudentForm>>>;

/** Derive the four wizard inputs from a loaded form + the course-schedule fileId. */
function computeFlowInputs(form: LoadedForm, courseScheduleFileId: string | null): FlowInputs {
  let availabilityComplete = false;
  if (
    form.position &&
    form.submission &&
    checkDesiredHours(form.submission.desiredHours, form.position).passed
  ) {
    availabilityComplete = validateAvailability(form.selection, form.position, form.blocks, {
      everyWeekendOptIn: form.submission.everyWeekendOptIn,
    }).canSubmit;
  }
  return {
    submitted: form.submission?.status === "submitted",
    hasSubmissionRow: form.submission !== null,
    hasCourseSchedule: Boolean(courseScheduleFileId),
    availabilityComplete,
  };
}

async function loadCourseScheduleFileId(email: string): Promise<string | null> {
  const [sub] = await getDb()
    .select({ courseScheduleFileId: submissions.courseScheduleFileId })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);
  return sub?.courseScheduleFileId ?? null;
}

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

  const inputs = computeFlowInputs(form, await loadCourseScheduleFileId(email));

  return {
    onRoster: true,
    displayName: form.student.displayName,
    positionId: form.student.positionId,
    positionName: positionName(form.student.positionId),
    international: form.student.international,
    access,
    status: flowStatus(inputs),
  };
}

/**
 * The wizard steps a student may currently navigate to (PLAN §4): the breadcrumb's
 * forward gate, mirroring the per-step "Next" gates. Off-roster/no-form students can
 * only reach the first step.
 */
export async function loadReachableSteps(email: string): Promise<WizardStepKey[]> {
  const form = await loadStudentForm(email);
  if (!form) return ["course-schedule"];
  return reachableStepKeys(computeFlowInputs(form, await loadCourseScheduleFileId(email)));
}
