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
 * `saveAvailabilityFor` is the admin's on-behalf-of save from the response page's
 * grid (§10a). It shares this file's persistence core, so an admin edit lands the
 * same way a student's own save would.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions, shiftSelections, flags, travelRequests } from "@/lib/db/schema";
import { requireEditableStudent } from "@/lib/groups/gate";
import { syncRevalidationFlag } from "@/lib/positions/apply-change";
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
  return autoAssigned;
}

/**
 * The submission-row fields a save writes. The student's own form owns all of
 * them; an admin saving from the response grid writes only the rotation, so the
 * student's desired hours and their note stay exactly as the student left them.
 */
interface SubmissionPatch {
  everyWeekendOptIn: boolean;
  desiredHours?: number | null;
  studentNotes?: string | null;
}

/**
 * Upsert the submission, replace its selection, and recompute its flags in one
 * transaction, then refresh the Drive sheet if this is a real (submitted)
 * response. Shared by the student's own save and the admin's on-behalf save.
 * Neither ever promotes a draft: the status is whatever the row already had, so
 * a row an admin starts stays a draft the student has yet to confirm.
 *
 * `studentEdit` decides whether this counts as the student changing their own
 * answers, which is exactly what `updated_at` records (PLAN §9): true for their
 * own save, false for an admin's on-behalf one.
 *
 * `revalidate` runs the generic revalidation seam (`syncRevalidationFlag`)
 * after the write, so the admin's override-save raises `revalidation_failed`
 * and a clean save clears it, exactly like a position change. The student's own
 * save skips it: their path is gated up front and self-heals via the blanket
 * flag rewrite in `writeSelectionAndFlags`.
 */
async function persistAvailability(args: {
  email: string;
  selection: SelectedShift[];
  patch: SubmissionPatch;
  position: Position;
  blocks: ShiftBlock[];
  studentEdit: boolean;
  revalidate?: boolean;
}): Promise<AutoAssignedShift | null> {
  const { email, selection, position, blocks } = args;
  const patch = args.studentEdit ? { ...args.patch, updatedAt: new Date() } : args.patch;
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
    if (args.revalidate) await syncRevalidationFlag(tx, submissionId);
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
    studentEdit: true,
  });

  revalidatePath("/availability");
  return { ok: true, autoAssigned, errors: [] };
}

/**
 * Save a student's availability on behalf of them, from the grid on the admin
 * response page (PLAN §10a). Writes only what that grid edits: the selected
 * cells and the weekend rotation.
 *
 * The admin is the authority here, not the form window, so hard rules warn
 * instead of blocking: a save that fails them is refused with the failing
 * checks until the caller re-sends with `overrideInvalid` (the grid's "Save
 * anyway" step). An override-save persists and raises `revalidation_failed`
 * through the generic revalidation seam, which a later clean save clears; the
 * student-facing form keeps refusing exactly as before. Status behaviour
 * matches the other on-behalf-of actions: this starts a draft when there is no
 * submission and never promotes one, so a row an admin created still reads
 * "missing" until the student confirms it themselves (`responseStatus`). It
 * also leaves `updated_at` alone, which tracks the student's own edits only.
 */
export async function saveAvailabilityFor(
  student: string,
  input: { selection: SelectedShift[]; everyWeekendOptIn: boolean; overrideInvalid?: boolean },
): Promise<SaveResult> {
  if (!student.trim()) return { ok: false, errors: ["No student was named."] };

  const gate = await requireEditableStudent(student);
  if (!gate.ok) return { ok: false, errors: [gate.error] };
  if (!gate.positionId) return { ok: false, errors: ["No position is set for this student."] };

  const posWithBlocks = await loadPositionWithBlocks(gate.positionId);
  if (!posWithBlocks) {
    return { ok: false, errors: ["This student's position configuration is missing."] };
  }
  const { position, blocks } = posWithBlocks;

  const validIds = new Set(blocks.map((b) => b.id));
  const selection = input.selection.filter((s) => validIds.has(s.blockId));

  // Same failure set the revalidation seam flags, so the warn list, the refusal,
  // and the stored flag always agree.
  if (!input.overrideInvalid) {
    const result = validateAvailability(selection, position, blocks, {
      everyWeekendOptIn: input.everyWeekendOptIn,
    });
    const failures = result.checks
      .filter((c) => c.severity === "hard" && !c.passed)
      .map((c) => c.detail);
    const db = getDb();
    const [sub] = await db
      .select({ desiredHours: submissions.desiredHours })
      .from(submissions)
      .where(eq(submissions.studentEmail, gate.email))
      .limit(1);
    const desiredCheck = checkDesiredHours(sub?.desiredHours ?? null, position);
    if (!desiredCheck.passed) failures.push(desiredCheck.detail);
    if (failures.length > 0) return { ok: false, errors: failures };
  }

  const autoAssigned = await persistAvailability({
    email: gate.email,
    selection,
    patch: { everyWeekendOptIn: input.everyWeekendOptIn },
    position,
    blocks,
    studentEdit: false,
    revalidate: true,
  });

  revalidatePath("/availability");
  revalidatePath(`/admin/students/${encodeURIComponent(gate.email)}`);
  return { ok: true, autoAssigned, errors: [] };
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
