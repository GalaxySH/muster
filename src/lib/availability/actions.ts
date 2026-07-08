"use server";

/**
 * Save the availability form + finalize the whole onboarding wizard (PLAN.md §7, §8, §13).
 *
 * The server is the authority: it reloads the position's blocks, drops any cells
 * the client shouldn't be able to select, re-runs the rules engine, and refuses
 * to advance (`mode: "continue"`) when a hard rule fails. Drafts persist
 * regardless so students can come back.
 *
 * Status semantics (PLAN §13, form-flow): `saveAvailability` NEVER promotes a
 * submission to "submitted" — that flip happens once, at the end of the wizard,
 * in `finalizeSubmission` (the exit-page submit). So:
 *   - "draft"    → save, no validation gate.
 *   - "continue" → validate (hard rules + desired hours); refuse on failure;
 *                  otherwise save and let the client advance to /travel.
 * A submission that is ALREADY submitted (a student editing after finishing)
 * stays submitted and keeps its finalize artifacts (weekend auto-assign + flags)
 * re-applied on each save, so the scheduler's view never goes stale.
 *
 * The one soft rule that needs server action — a non-exempt student who picked
 * no weekend shift gets one auto-assigned (PLAN §5 #5) — plus the late-travel
 * flag (§8) are written by `writeSelectionAndFlags` whenever the effective status
 * is "submitted".
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions, shiftSelections, flags, travelRequests } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { resolveStudentAccess } from "@/lib/groups/data";
import {
  NO_GROUP_MESSAGE,
  SUBMITTED_LOCK_MESSAGE,
  lockedReasonLine,
} from "@/lib/groups/window-message";
import { loadPositionWithBlocks } from "./data";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { chooseWeekendAutoAssign, needsWeekendAutoAssign } from "@/lib/domain/auto-assign";
import { trySyncResponsesSheet } from "@/lib/admin/sheet-sync";
import { formatTime } from "@/lib/domain/time";
import type { Day, Position, SelectedShift, ShiftBlock } from "@/lib/domain/types";

/** Drizzle transaction handle (extracted so the selection writer can share a tx). */
type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface SaveAvailabilityInput {
  selection: SelectedShift[];
  everyWeekendOptIn: boolean;
  desiredHours: number | null;
  /** Free-text note the student adds about their requested schedule (PLAN §7). */
  notes: string;
  /** "continue" validates + (on success) lets the client advance; "draft" just saves. */
  mode: "draft" | "continue";
}

export interface AutoAssignedShift extends SelectedShift {
  /** Human label for the chosen cell, e.g. "Sat 8:30a–11a". */
  label: string;
}

export interface SaveResult {
  ok: boolean;
  /** Set when a weekend shift was auto-assigned (only on an already-submitted form). */
  autoAssigned?: AutoAssignedShift | null;
  errors: string[];
}

export interface FinalizeResult {
  ok: boolean;
  error?: string;
  /** Where to send the student to fix the problem (e.g. "/course-schedule"). */
  fixHref?: string;
  autoAssigned?: AutoAssignedShift | null;
}

const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function describeCell(cell: SelectedShift, blocks: ShiftBlock[]): string {
  const block = blocks.find((b) => b.id === cell.blockId);
  if (!block) return DAY_LABEL[cell.day];
  return `${DAY_LABEL[cell.day]} ${formatTime(block.start)}–${formatTime(block.end)}`;
}

/**
 * Replace a submission's selection rows and recompute its flags inside a tx.
 * When the effective status is "submitted" it also performs the weekend
 * auto-assign (reusing any prior machine pick) and raises the soft-rule flags;
 * a draft clears both. Returns the auto-assigned cell, if any.
 */
async function writeSelectionAndFlags(
  tx: DbTransaction,
  args: {
    submissionId: string;
    status: "draft" | "submitted";
    selection: SelectedShift[];
    position: Position;
    blocks: ShiftBlock[];
  },
): Promise<AutoAssignedShift | null> {
  const { submissionId, status, selection, position, blocks } = args;
  const isSubmitted = status === "submitted";

  // Reuse a prior machine-pick so a re-save keeps the same weekend cell.
  let chosen: SelectedShift | null = null;
  if (isSubmitted && needsWeekendAutoAssign(selection, position)) {
    const priorRows = await tx
      .select({
        blockId: shiftSelections.shiftBlockId,
        day: shiftSelections.day,
        autoAssigned: shiftSelections.autoAssigned,
      })
      .from(shiftSelections)
      .where(eq(shiftSelections.submissionId, submissionId));
    const preferred = priorRows.find((r) => r.autoAssigned) ?? null;
    chosen = chooseWeekendAutoAssign(blocks, {
      preferred: preferred ? { blockId: preferred.blockId, day: preferred.day } : null,
    });
  }

  // Replace-all selection strategy keeps the write simple and correct.
  await tx.delete(shiftSelections).where(eq(shiftSelections.submissionId, submissionId));
  const rows = selection.map((s) => ({
    submissionId,
    shiftBlockId: s.blockId,
    day: s.day,
    autoAssigned: false,
  }));
  let autoAssigned: AutoAssignedShift | null = null;
  if (chosen) {
    rows.push({ submissionId, shiftBlockId: chosen.blockId, day: chosen.day, autoAssigned: true });
    autoAssigned = { ...chosen, label: describeCell(chosen, blocks) };
  }
  if (rows.length > 0) await tx.insert(shiftSelections).values(rows);

  // Flags are recomputed from scratch on every save; only a submitted form raises them.
  await tx.delete(flags).where(eq(flags.submissionId, submissionId));
  if (isSubmitted) {
    if (autoAssigned) {
      await tx.insert(flags).values({
        id: randomUUID(),
        submissionId,
        type: "auto_assigned_weekend",
        detail: `No weekend shift selected; auto-assigned ${autoAssigned.label}.`,
      });
    }
    // Late travel (unexcused entries) → flag for the scheduler (§8). Under the
    // active "refuse" late policy (domain/travel.ts) unexcused rows can't be
    // created, so this stays dormant until the policy flips to accept-and-flag.
    const lateTravel = await tx
      .select({ id: travelRequests.id })
      .from(travelRequests)
      .where(and(eq(travelRequests.submissionId, submissionId), eq(travelRequests.excused, false)));
    if (lateTravel.length > 0) {
      await tx.insert(flags).values({
        id: randomUUID(),
        submissionId,
        type: "travel_late",
        detail: `${lateTravel.length} travel entr${lateTravel.length === 1 ? "y" : "ies"} added after the cutoff (not excused).`,
      });
    }
  }
  return autoAssigned;
}

/** Shared access gate for the availability/finalize actions (PLAN §13). */
async function gateStudent(): Promise<
  | { ok: true; email: string }
  | { ok: false; error: string }
> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  const student = await findStudentByEmail(session.email);
  if (!student) return { ok: false, error: "You are not on the roster." };

  const access = await resolveStudentAccess(student.email);
  if (access.access === "no-group") return { ok: false, error: NO_GROUP_MESSAGE };
  if (!access.canEdit) {
    const error = access.lockedAfterSubmit
      ? SUBMITTED_LOCK_MESSAGE
      : lockedReasonLine(access.state, access.opensAt, access.closesAt);
    return { ok: false, error };
  }
  return { ok: true, email: student.email };
}

export async function saveAvailability(input: SaveAvailabilityInput): Promise<SaveResult> {
  const gate = await gateStudent();
  if (!gate.ok) return { ok: false, errors: [gate.error] };

  const student = await findStudentByEmail(gate.email);
  if (!student?.positionId)
    return { ok: false, errors: ["No position is set for your account yet."] };

  const posWithBlocks = await loadPositionWithBlocks(student.positionId);
  if (!posWithBlocks) return { ok: false, errors: ["Your position configuration is missing."] };
  const { position, blocks } = posWithBlocks;

  // Trust only cells that belong to this position's blocks.
  const validIds = new Set(blocks.map((b) => b.id));
  const selection = input.selection.filter((s) => validIds.has(s.blockId));

  const result = validateAvailability(selection, position, blocks, {
    everyWeekendOptIn: input.everyWeekendOptIn,
  });

  const desiredHours =
    typeof input.desiredHours === "number" &&
    Number.isFinite(input.desiredHours) &&
    input.desiredHours > 0
      ? input.desiredHours
      : null;
  const studentNotes = input.notes.trim() || null;

  // "continue" is a hard gate: refuse to advance (and don't persist) on failure,
  // exactly as the old submit did — students can "Save draft" to keep work safe.
  if (input.mode === "continue") {
    const errors = result.checks
      .filter((c) => c.severity === "hard" && !c.passed)
      .map((c) => c.detail);
    const desiredCheck = checkDesiredHours(desiredHours, position);
    if (!desiredCheck.passed) errors.push(desiredCheck.detail);
    if (errors.length > 0) return { ok: false, errors };
  }

  const db = getDb();
  const { effectiveStatus, autoAssigned } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: submissions.id, status: submissions.status })
      .from(submissions)
      .where(eq(submissions.studentEmail, student.email))
      .limit(1);

    // Never promote here; preserve whatever status the submission already has.
    const status: "draft" | "submitted" = existing?.status ?? "draft";

    let submissionId: string;
    if (existing) {
      submissionId = existing.id;
      await tx
        .update(submissions)
        .set({ everyWeekendOptIn: input.everyWeekendOptIn, desiredHours, studentNotes })
        .where(eq(submissions.id, submissionId));
    } else {
      submissionId = randomUUID();
      await tx.insert(submissions).values({
        id: submissionId,
        studentEmail: student.email,
        status: "draft",
        everyWeekendOptIn: input.everyWeekendOptIn,
        desiredHours,
        studentNotes,
      });
    }

    const auto = await writeSelectionAndFlags(tx, {
      submissionId,
      status,
      selection,
      position,
      blocks,
    });
    return { effectiveStatus: status, autoAssigned: auto };
  });

  // Keep the running Drive spreadsheet fresh only when an actual response changed
  // (i.e. the form is already submitted). Drafts never trigger it.
  if (effectiveStatus === "submitted") await trySyncResponsesSheet();

  revalidatePath("/availability");
  return { ok: true, autoAssigned, errors: [] };
}

/**
 * Finalize the whole wizard (the exit-page submit, PLAN §13). This is the single
 * place a submission flips to "submitted". It re-validates the saved availability
 * as the authority, requires the course schedule, then stamps the submission,
 * performs the weekend auto-assign, raises flags, and refreshes the Drive sheet.
 */
export async function finalizeSubmission(): Promise<FinalizeResult> {
  const gate = await gateStudent();
  if (!gate.ok) return { ok: false, error: gate.error };
  const email = gate.email;

  const student = await findStudentByEmail(email);
  if (!student?.positionId)
    return { ok: false, error: "No position is set for your account yet." };

  const posWithBlocks = await loadPositionWithBlocks(student.positionId);
  if (!posWithBlocks) return { ok: false, error: "Your position configuration is missing." };
  const { position, blocks } = posWithBlocks;

  const db = getDb();
  const [sub] = await db
    .select({
      id: submissions.id,
      everyWeekendOptIn: submissions.everyWeekendOptIn,
      desiredHours: submissions.desiredHours,
      courseScheduleFileId: submissions.courseScheduleFileId,
    })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);

  if (!sub) {
    return { ok: false, error: "Start the form first.", fixHref: "/course-schedule" };
  }
  if (!sub.courseScheduleFileId) {
    return {
      ok: false,
      error: "Upload your course schedule before submitting.",
      fixHref: "/course-schedule",
    };
  }

  const validIds = new Set(blocks.map((b) => b.id));
  const selRows = await db
    .select({ blockId: shiftSelections.shiftBlockId, day: shiftSelections.day })
    .from(shiftSelections)
    .where(and(eq(shiftSelections.submissionId, sub.id), eq(shiftSelections.autoAssigned, false)));
  const selection = selRows
    .map((r) => ({ blockId: r.blockId, day: r.day }))
    .filter((s) => validIds.has(s.blockId));

  const result = validateAvailability(selection, position, blocks, {
    everyWeekendOptIn: sub.everyWeekendOptIn,
  });
  const hardFailures = result.checks.filter((c) => c.severity === "hard" && !c.passed);
  if (hardFailures.length > 0 || !checkDesiredHours(sub.desiredHours, position).passed) {
    return {
      ok: false,
      error: "Finish your availability before submitting.",
      fixHref: "/availability",
    };
  }

  let autoAssigned: AutoAssignedShift | null = null;
  await db.transaction(async (tx) => {
    await tx
      .update(submissions)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(eq(submissions.id, sub.id));
    autoAssigned = await writeSelectionAndFlags(tx, {
      submissionId: sub.id,
      status: "submitted",
      selection,
      position,
      blocks,
    });
  });

  await trySyncResponsesSheet();
  revalidatePath("/availability");
  revalidatePath("/me");
  return { ok: true, autoAssigned };
}
