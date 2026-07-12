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
import { countCloseClaims, isCloseStepRequired } from "@/lib/closes/data";
import {
  flowStatus,
  reachableStepKeys,
  wizardSteps,
  type FlowInputs,
  type FlowStatus,
  type WizardStep,
  type WizardStepKey,
} from "./steps";
import { isReturningStudent } from "./returner";

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
      /** Hired before the current cycle (§4.1) → show a welcome-back greeting. */
      returning: boolean;
      access: FlowAccess;
      status: FlowStatus;
      /** SL close picking (§18a): whether it applies and how many claims are held. */
      closes: { required: boolean; count: number };
    };

type LoadedForm = NonNullable<Awaited<ReturnType<typeof loadStudentForm>>>;

/** Derive the wizard inputs from a loaded form, the course-schedule fileId, and closes state. */
function computeFlowInputs(
  form: LoadedForm,
  courseScheduleFileId: string | null,
  closes: { required: boolean; count: number },
): FlowInputs {
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
    closesRequired: closes.required,
    closeClaimCount: closes.count,
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

/** SL close-step state (§18a): does it apply, and how many claims are held. */
async function loadCloses(
  positionId: string | null,
  email: string,
): Promise<{ required: boolean; count: number }> {
  if (!(await isCloseStepRequired(positionId))) return { required: false, count: 0 };
  return { required: true, count: await countCloseClaims(email) };
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

  const closes = await loadCloses(form.student.positionId, email);
  const inputs = computeFlowInputs(form, await loadCourseScheduleFileId(email), closes);

  return {
    onRoster: true,
    displayName: form.student.displayName,
    positionId: form.student.positionId,
    positionName: form.position?.name ?? null,
    international: form.student.international,
    returning: isReturningStudent(form.student.hiredOn, new Date()),
    access,
    status: flowStatus(inputs),
    closes,
  };
}

export interface WizardNav {
  /** The data steps this student walks (SLs get the closes step, §18a). */
  steps: WizardStep[];
  /** Which of those steps the breadcrumb may link to right now. */
  reachable: WizardStepKey[];
}

/**
 * The wizard breadcrumb state (PLAN §4): the student's step list plus the
 * forward gate, mirroring the per-step "Next" gates. Off-roster/no-form
 * students see the base steps with only the first reachable.
 */
export async function loadWizardNav(email: string): Promise<WizardNav> {
  const form = await loadStudentForm(email);
  if (!form) return { steps: wizardSteps(false), reachable: ["course-schedule"] };
  const closes = await loadCloses(form.student.positionId, email);
  const inputs = computeFlowInputs(form, await loadCourseScheduleFileId(email), closes);
  return { steps: wizardSteps(closes.required), reachable: reachableStepKeys(inputs) };
}
