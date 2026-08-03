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
 * submission to "submitted": that flip happens once, at the end of the wizard,
 * in `finalizeSubmission` (the exit-page submit). So:
 *   - "draft"    → save, no validation gate.
 *   - "continue" → validate (hard rules + desired hours); refuse on failure;
 *                  otherwise save and let the client advance to /travel.
 * A submission that is ALREADY submitted (a student editing after finishing)
 * stays submitted and keeps its finalize artifacts (weekend auto-assign + flags)
 * re-applied on each save, so the scheduler's view never goes stale.
 *
 * The one soft rule that needs server action (a non-exempt student who picked
 * no weekend shift gets one auto-assigned, PLAN §5 #5) plus the late-travel
 * flag (§8) are written by `writeSelectionAndFlags` whenever the effective status
 * is "submitted".
 *
 * `saveAvailabilityFor` is the admin's save from the response page's grid
 * (§10a). It writes the INTERNAL copy only (internal_availability +
 * internal_selections): the student's own submission row, selections, and
 * flags are never modified by an admin edit, and scheduling surfaces read the
 * internal copy in its place (lib/availability/effective.ts). The student
 * save path below stays exactly as it was.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  submissions,
  shiftSelections,
  internalAvailability,
  internalSelections,
  flags,
  travelRequests,
} from "@/lib/db/schema";
import { ensureSubmissionId } from "@/lib/evidence/data";
import { requireEditableStudent } from "@/lib/groups/gate";
import { loadPositionWithBlocks } from "./data";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { chooseWeekendAutoAssign, needsWeekendAutoAssign } from "@/lib/domain/auto-assign";
import { REQUIRED_CLOSE_CLAIMS } from "@/lib/domain/close-claims";
import { countCloseClaims, isCloseStepRequired } from "@/lib/closes/data";
import { trySyncSheet, RESPONSES_SHEET } from "@/lib/admin/sheet-sync";
import { formatTime } from "@/lib/domain/time";
import { DAY_LABEL, type Position, type SelectedShift, type ShiftBlock } from "@/lib/domain/types";

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

function describeCell(cell: SelectedShift, blocks: ShiftBlock[]): string {
  const block = blocks.find((b) => b.id === cell.blockId);
  if (!block) return DAY_LABEL[cell.day];
  return `${DAY_LABEL[cell.day]} ${formatTime(block.start)}–${formatTime(block.end)}`;
}

/** The two availability-cell tables share one shape; the writer serves both. */
type SelectionTable = typeof shiftSelections | typeof internalSelections;

/**
 * Replace one table's selection cells for a submission inside a tx, with the
 * weekend auto-assign applied (reusing any prior machine pick so a re-save
 * keeps the same weekend cell). Shared by the student's own save
 * (shift_selections) and the admin's internal save (internal_selections).
 * Returns the auto-assigned cell, if any.
 */
async function replaceSelectionCells(
  tx: DbTransaction,
  table: SelectionTable,
  args: {
    submissionId: string;
    /**
     * Weekend auto-assign (PLAN §5 #5) is a student-path behavior for a
     * submitted response. The internal copy is always written literally, so
     * the admin save passes false.
     */
    applyAutoAssign: boolean;
    selection: SelectedShift[];
    position: Position;
    blocks: ShiftBlock[];
  },
): Promise<AutoAssignedShift | null> {
  const { submissionId, applyAutoAssign, selection, position, blocks } = args;

  let chosen: SelectedShift | null = null;
  if (applyAutoAssign && needsWeekendAutoAssign(selection, position)) {
    const priorRows = await tx
      .select({
        blockId: table.shiftBlockId,
        day: table.day,
        autoAssigned: table.autoAssigned,
      })
      .from(table)
      .where(eq(table.submissionId, submissionId));
    const preferred = priorRows.find((r) => r.autoAssigned) ?? null;
    chosen = chooseWeekendAutoAssign(blocks, {
      preferred: preferred ? { blockId: preferred.blockId, day: preferred.day } : null,
    });
  }

  // Replace-all selection strategy keeps the write simple and correct.
  await tx.delete(table).where(eq(table.submissionId, submissionId));
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
  if (rows.length > 0) await tx.insert(table).values(rows);
  return autoAssigned;
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

  const autoAssigned = await replaceSelectionCells(tx, shiftSelections, {
    submissionId,
    applyAutoAssign: isSubmitted,
    selection,
    position,
    blocks,
  });

  // Flags are recomputed from scratch on every save; only a submitted form
  // raises them. The blanket delete is intentional: it also clears any
  // position_change or revalidation_failed flag (roadmap 3.3), since the
  // student saving again is exactly the self-heal those flags wait for.
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

  // Only student saves reach this function, so cells just changed underneath
  // any admin-curated internal copy. Surface that to the scheduler; the
  // blanket delete above wiped any earlier copy of the flag, and an admin
  // re-saving or reverting the internal copy clears it. Raised on drafts too:
  // the mismatch exists regardless of status.
  const [internal] = await tx
    .select({ submissionId: internalAvailability.submissionId })
    .from(internalAvailability)
    .where(eq(internalAvailability.submissionId, submissionId))
    .limit(1);
  if (internal) {
    await tx.insert(flags).values({
      id: randomUUID(),
      submissionId,
      type: "student_changed_after_internal_edit",
      detail: "The student changed their availability after it was adjusted internally.",
    });
  }
  return autoAssigned;
}

/** The submission-row fields the student's own save writes. */
interface SubmissionPatch {
  everyWeekendOptIn: boolean;
  desiredHours: number | null;
  studentNotes: string | null;
}

/**
 * Upsert the submission, replace its selection, and recompute its flags in one
 * transaction, then refresh the Drive sheet if this is a real (submitted)
 * response. The student's own save path only: an admin's edit goes to the
 * internal copy (`saveAvailabilityFor`) and never touches these rows. Never
 * promotes a draft: the status is whatever the row already had. Every save
 * here stamps `updated_at`, which records the student's own edits (PLAN §9).
 */
async function persistAvailability(args: {
  email: string;
  selection: SelectedShift[];
  patch: SubmissionPatch;
  position: Position;
  blocks: ShiftBlock[];
}): Promise<AutoAssignedShift | null> {
  const { email, selection, position, blocks } = args;
  const patch = { ...args.patch, updatedAt: new Date() };
  const db = getDb();
  const { effectiveStatus, autoAssigned } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: submissions.id, status: submissions.status })
      .from(submissions)
      .where(eq(submissions.studentEmail, email))
      .limit(1);

    // Never promote here; preserve whatever status the submission already has.
    const status: "draft" | "submitted" = existing?.status ?? "draft";

    let submissionId: string;
    if (existing) {
      submissionId = existing.id;
      await tx.update(submissions).set(patch).where(eq(submissions.id, submissionId));
    } else {
      submissionId = randomUUID();
      await tx.insert(submissions).values({
        id: submissionId,
        studentEmail: email,
        status: "draft",
        ...patch,
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
  if (effectiveStatus === "submitted") await trySyncSheet(RESPONSES_SHEET);
  return autoAssigned;
}

export async function saveAvailability(input: SaveAvailabilityInput): Promise<SaveResult> {
  const gate = await requireEditableStudent();
  if (!gate.ok) return { ok: false, errors: [gate.error] };
  if (!gate.positionId) return { ok: false, errors: ["No position is set for your account yet."] };

  const posWithBlocks = await loadPositionWithBlocks(gate.positionId);
  if (!posWithBlocks) return { ok: false, errors: ["Your position configuration is missing."] };
  const { position, blocks } = posWithBlocks;

  // Trust only cells that belong to this position's blocks.
  const validIds = new Set(blocks.map((b) => b.id));
  const selection = input.selection.filter((s) => validIds.has(s.blockId));

  const desiredHours =
    typeof input.desiredHours === "number" &&
    Number.isFinite(input.desiredHours) &&
    input.desiredHours > 0
      ? input.desiredHours
      : null;
  const studentNotes = input.notes.trim() || null;

  // "continue" is a hard gate: refuse to advance (and don't persist) on failure,
  // exactly as the old submit did; students can "Save draft" to keep work safe.
  if (input.mode === "continue") {
    const result = validateAvailability(selection, position, blocks, {
      everyWeekendOptIn: input.everyWeekendOptIn,
    });
    const errors = result.checks
      .filter((c) => c.severity === "hard" && !c.passed)
      .map((c) => c.detail);
    const desiredCheck = checkDesiredHours(desiredHours, position);
    if (!desiredCheck.passed) errors.push(desiredCheck.detail);
    if (errors.length > 0) return { ok: false, errors };
  }

  const autoAssigned = await persistAvailability({
    email: gate.email,
    selection,
    patch: { everyWeekendOptIn: input.everyWeekendOptIn, desiredHours, studentNotes },
    position,
    blocks,
  });

  revalidatePath("/availability");
  return { ok: true, autoAssigned, errors: [] };
}

/**
 * Save the admin's INTERNAL copy of a student's availability, from the grid on
 * the response page (PLAN §10a). Writes internal_availability +
 * internal_selections only: the student's own submission row, shift_selections,
 * and flags stay exactly as the student left them, and scheduling surfaces
 * read the internal copy in their place. Saving also clears the
 * student_changed_after_internal_edit flag: the admin has just seen and
 * re-curated the response.
 *
 * The admin is the authority here, not the form window, so hard rules warn
 * instead of blocking: a save that fails them is refused with the failing
 * checks until the caller re-sends with `overrideInvalid` (the grid's "Save
 * anyway" step). No flag is raised for an override: the internal copy is the
 * admin's own working state, and `revalidation_failed` keeps meaning the
 * STUDENT's stored answers fail the current rules. This still starts a stub
 * draft when there is no submission (the internal copy hangs off the
 * submission row), which never promotes and still reads "missing" until the
 * student confirms it themselves (`responseStatus`).
 *
 * The copy is saved LITERALLY: no weekend auto-assign ever runs here (PLAN §5
 * #5 is a student-form behavior). An admin leaving the weekend empty means
 * exactly that, and the generator schedules no weekend shift for the student.
 */
export async function saveAvailabilityFor(
  student: string,
  input: { selection: SelectedShift[]; everyWeekendOptIn: boolean; overrideInvalid?: boolean },
): Promise<SaveResult> {
  if (!student.trim()) return { ok: false, errors: ["No student was named."] };

  const gate = await requireEditableStudent(student);
  if (!gate.ok) return { ok: false, errors: [gate.error] };
  if (!gate.positionId) return { ok: false, errors: ["No position is set for this student."] };
  const session = await getAppSession();
  if (!session) return { ok: false, errors: ["You are not signed in."] };

  const posWithBlocks = await loadPositionWithBlocks(gate.positionId);
  if (!posWithBlocks) {
    return { ok: false, errors: ["This student's position configuration is missing."] };
  }
  const { position, blocks } = posWithBlocks;

  const validIds = new Set(blocks.map((b) => b.id));
  const selection = input.selection.filter((s) => validIds.has(s.blockId));

  const db = getDb();
  const [sub] = await db
    .select({ desiredHours: submissions.desiredHours, status: submissions.status })
    .from(submissions)
    .where(eq(submissions.studentEmail, gate.email))
    .limit(1);

  // Same checks the grid previews, so the warn list and the refusal agree.
  if (!input.overrideInvalid) {
    const result = validateAvailability(selection, position, blocks, {
      everyWeekendOptIn: input.everyWeekendOptIn,
    });
    const failures = result.checks
      .filter((c) => c.severity === "hard" && !c.passed)
      .map((c) => c.detail);
    const desiredCheck = checkDesiredHours(sub?.desiredHours ?? null, position);
    if (!desiredCheck.passed) failures.push(desiredCheck.detail);
    if (failures.length > 0) return { ok: false, errors: failures };
  }

  const submissionId = await ensureSubmissionId(gate.email);
  const status = sub?.status ?? "draft";

  const autoAssigned = await db.transaction(async (tx) => {
    await tx
      .insert(internalAvailability)
      .values({
        submissionId,
        everyWeekendOptIn: input.everyWeekendOptIn,
        editedBy: session.email,
      })
      .onDuplicateKeyUpdate({
        set: {
          everyWeekendOptIn: input.everyWeekendOptIn,
          editedBy: session.email,
          editedAt: new Date(),
        },
      });
    const auto = await replaceSelectionCells(tx, internalSelections, {
      submissionId,
      applyAutoAssign: false,
      selection,
      position,
      blocks,
    });
    await tx
      .delete(flags)
      .where(
        and(
          eq(flags.submissionId, submissionId),
          eq(flags.type, "student_changed_after_internal_edit"),
        ),
      );
    return auto;
  });

  // The export and running sheet carry the "adjusted internally" marker, so a
  // real (submitted) response keeps the sheet fresh here too.
  if (status === "submitted") await trySyncSheet(RESPONSES_SHEET);
  revalidatePath(`/admin/students/${encodeURIComponent(gate.email)}`);
  return { ok: true, autoAssigned, errors: [] };
}

export interface RevertInternalResult {
  ok: boolean;
  error?: string;
}

/**
 * Drop the internal copy so scheduling surfaces fall back to the student's own
 * availability (PLAN §10a). Also clears the reconcile flag; the student's rows
 * are untouched, since internal edits never modified them. No-op when there is
 * nothing to revert.
 */
export async function revertInternalAvailability(student: string): Promise<RevertInternalResult> {
  if (!student.trim()) return { ok: false, error: "No student was named." };
  const gate = await requireEditableStudent(student);
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [sub] = await db
    .select({ id: submissions.id, status: submissions.status })
    .from(submissions)
    .where(eq(submissions.studentEmail, gate.email))
    .limit(1);
  if (!sub) return { ok: true };

  await db.transaction(async (tx) => {
    // internal_selections cascades off the header row.
    await tx.delete(internalAvailability).where(eq(internalAvailability.submissionId, sub.id));
    await tx
      .delete(flags)
      .where(
        and(eq(flags.submissionId, sub.id), eq(flags.type, "student_changed_after_internal_edit")),
      );
  });

  if (sub.status === "submitted") await trySyncSheet(RESPONSES_SHEET);
  revalidatePath(`/admin/students/${encodeURIComponent(gate.email)}`);
  return { ok: true };
}

/**
 * Finalize the whole wizard (the exit-page submit, PLAN §13). This is the single
 * place a submission flips to "submitted". It re-validates the saved availability
 * as the authority, requires the course schedule, then stamps the submission,
 * performs the weekend auto-assign, raises flags, and refreshes the Drive sheet.
 */
export async function finalizeSubmission(): Promise<FinalizeResult> {
  const gate = await requireEditableStudent();
  if (!gate.ok) return { ok: false, error: gate.error };
  const email = gate.email;
  if (!gate.positionId) return { ok: false, error: "No position is set for your account yet." };

  const posWithBlocks = await loadPositionWithBlocks(gate.positionId);
  if (!posWithBlocks) return { ok: false, error: "Your position configuration is missing." };
  const { position, blocks } = posWithBlocks;

  const db = getDb();
  const [sub] = await db
    .select({
      id: submissions.id,
      everyWeekendOptIn: submissions.everyWeekendOptIn,
      desiredHours: submissions.desiredHours,
      courseScheduleFileId: submissions.courseScheduleFileId,
      submittedAt: submissions.submittedAt,
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

  // SL close-picking gate (PLAN §18a): a Shift Lead must hold exactly the
  // required number of weekend closes before finalizing. Dormant until an
  // admin generates the close inventory.
  if (await isCloseStepRequired(gate.positionId)) {
    const claimCount = await countCloseClaims(email);
    if (claimCount !== REQUIRED_CLOSE_CLAIMS) {
      return {
        ok: false,
        error: `Pick your ${REQUIRED_CLOSE_CLAIMS} weekend closes before submitting.`,
        fixHref: "/closes",
      };
    }
  }

  let autoAssigned: AutoAssignedShift | null = null;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(submissions)
      // submittedAt records the FIRST submit, so a student finishing the wizard
      // again keeps their original stamp; updatedAt moves, since they just edited.
      .set({ status: "submitted", submittedAt: sub.submittedAt ?? now, updatedAt: now })
      .where(eq(submissions.id, sub.id));
    autoAssigned = await writeSelectionAndFlags(tx, {
      submissionId: sub.id,
      status: "submitted",
      selection,
      position,
      blocks,
    });
  });

  await trySyncSheet(RESPONSES_SHEET);
  revalidatePath("/availability");
  revalidatePath("/me");
  return { ok: true, autoAssigned };
}
