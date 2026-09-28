"use server";

/**
 * Evidence upload/save actions (PLAN.md §7b, §12). Each relays bytes to Drive
 * and persists only the returned fileId (or text). The server is the authority:
 * it re-validates the file, owns the student↔submission link, and never writes
 * image bytes to the app's storage.
 *
 * Every action also runs for an admin acting **on behalf of** a student (the
 * target email rides in the FormData `student` field, or an argument for the
 * ones that don't take FormData); `requireEditableStudent` admin-gates it.
 * `removeCourseSchedule` runs only that way.
 * Only the student's own path stamps `updated_at` (see `editStamp`): that column
 * answers "when did the student last change their answers", so an admin filling
 * something in for them must not disturb it.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions, extracurricularFiles, travelRequests } from "@/lib/db/schema";
import { requireEditableStudent } from "@/lib/groups/gate";
import { validateEvidenceUpload } from "@/lib/drive/upload-validation";
import { relayUpload, relayDelete, NoDriveGrantError } from "@/lib/drive/relay";
import { ensureSubmissionId } from "./data";
import { isAtEvidenceCap, MAX_EXTRACURRICULAR_FILES, MAX_TRAVEL_REQUESTS } from "./limits";
import { decideTravelSubmission } from "@/lib/domain/travel";
import { calendarDate } from "@/lib/domain/calendar-day";
import { getTravelCutoff, getLateTravelPolicy } from "@/lib/settings";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Whose evidence is this? Normally the signed-in student's own, gated on the
 * shared student gate (PLAN §13): roster + group + open window. Uploading and
 * removing evidence is part of editing the submission, so it locks with the form.
 *
 * An admin may instead name a student to act for (the per-student response page,
 * mirroring the change-request `employee` seam). The gate owns that rule: it
 * skips the window checks for an on-behalf target and refuses one for everyone
 * else.
 */
async function requireStudent(
  onBehalfOf = "",
): Promise<{ email: string; onBehalf: boolean } | { error: string }> {
  const gate = await requireEditableStudent(onBehalfOf);
  return gate.ok ? { email: gate.email, onBehalf: gate.onBehalf } : { error: gate.error };
}

/** The student page the entry lives on, plus the admin's view of it when they added it. */
function revalidateEvidence(studentPath: string, who: { email: string; onBehalf: boolean }) {
  revalidatePath(studentPath);
  if (who.onBehalf) revalidatePath(`/admin/students/${encodeURIComponent(who.email)}`);
}

/**
 * `updated_at` records when the STUDENT last changed their own answers (PLAN §9),
 * so an admin acting on their behalf deliberately leaves it where it was.
 *
 * `editStamp` spreads into a `.set()` that is already updating the submission row;
 * `touchSubmission` is for the actions that only wrote child rows (a travel entry,
 * a proof file) and still need the parent's stamp moved.
 */
const editStamp = (who: { onBehalf: boolean }) => (who.onBehalf ? {} : { updatedAt: new Date() });

async function touchSubmission(submissionId: string, who: { onBehalf: boolean }): Promise<void> {
  if (who.onBehalf) return;
  await getDb()
    .update(submissions)
    .set({ updatedAt: new Date() })
    .where(eq(submissions.id, submissionId));
}

/** The admin-only "act for this student" field the response-page modal submits. */
const onBehalfOf = (formData: FormData) => String(formData.get("student") ?? "").trim();

/** Pull a File out of FormData and read it into a Buffer after validation. */
async function readUpload(
  formData: FormData,
): Promise<{ mimeType: string; bytes: Buffer } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file was provided." };
  const check = validateEvidenceUpload({ type: file.type, size: file.size });
  if (!check.ok) return { error: check.error ?? "Invalid file." };
  return { mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
}

function relayError(e: unknown): string {
  if (e instanceof NoDriveGrantError) return e.message;
  console.error("Evidence relay failed:", e);
  return "Upload failed. Please try again.";
}

// NOTE (future): we may restrict the course schedule specifically to image
// types (PNG/JPEG); PDFs can't be shown as a glanceable thumbnail beside the
// preferences grid. Other evidence (travel itineraries) keeps PDF support.
export async function uploadCourseSchedule(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf(formData));
  if ("error" in who) return { ok: false, error: who.error };
  const upload = await readUpload(formData);
  if ("error" in upload) return { ok: false, error: upload.error };

  try {
    const fileId = await relayUpload({ studentEmail: who.email, kind: "course", ...upload });
    const db = getDb();
    const submissionId = await ensureSubmissionId(who.email);
    const [prev] = await db
      .select({ courseScheduleFileId: submissions.courseScheduleFileId })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    await db
      .update(submissions)
      .set({ courseScheduleFileId: fileId, ...editStamp(who) })
      .where(eq(submissions.id, submissionId));
    if (prev?.courseScheduleFileId) await relayDelete(prev.courseScheduleFileId);
    revalidateEvidence("/course-schedule", who);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

/**
 * Admin only. The course schedule is required of students, so their own page
 * offers Replace and never an empty slot; clearing one (say, a schedule filed
 * under the wrong person) is the scheduler's call on the response page.
 */
export async function removeCourseSchedule(onBehalfOf?: string): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf);
  if ("error" in who) return { ok: false, error: who.error };
  if (!who.onBehalf) return { ok: false, error: "Only an admin can remove a course schedule." };

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  const [row] = await db
    .select({ courseScheduleFileId: submissions.courseScheduleFileId })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!row?.courseScheduleFileId) return { ok: false, error: "No course schedule is on file." };

  await db
    .update(submissions)
    .set({ courseScheduleFileId: null, ...editStamp(who) })
    .where(eq(submissions.id, submissionId));
  await relayDelete(row.courseScheduleFileId);
  revalidateEvidence("/course-schedule", who);
  return { ok: true };
}

export async function addExtracurricularFile(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf(formData));
  if ("error" in who) return { ok: false, error: who.error };
  const upload = await readUpload(formData);
  if ("error" in upload) return { ok: false, error: upload.error };

  // Cap before relaying so a rejected upload never orphans a Drive file.
  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  const ecCount = await db
    .select({ n: sql<number>`count(*)` })
    .from(extracurricularFiles)
    .where(eq(extracurricularFiles.submissionId, submissionId));
  if (isAtEvidenceCap(Number(ecCount[0]?.n ?? 0), MAX_EXTRACURRICULAR_FILES)) {
    return {
      ok: false,
      error: `You can upload at most ${MAX_EXTRACURRICULAR_FILES} extracurricular files. Remove one to add another.`,
    };
  }

  try {
    const fileId = await relayUpload({
      studentEmail: who.email,
      kind: "extracurricular",
      ...upload,
    });
    await db.insert(extracurricularFiles).values({ id: randomUUID(), submissionId, fileId });
    await touchSubmission(submissionId, who);
    revalidateEvidence("/course-schedule", who);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

export async function removeExtracurricularFile(
  rowId: string,
  onBehalfOf?: string,
): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf);
  if ("error" in who) return { ok: false, error: who.error };

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  const [row] = await db
    .select({ fileId: extracurricularFiles.fileId })
    .from(extracurricularFiles)
    .where(
      and(eq(extracurricularFiles.id, rowId), eq(extracurricularFiles.submissionId, submissionId)),
    )
    .limit(1);
  if (!row) return { ok: false, error: "File not found." };

  await db.delete(extracurricularFiles).where(eq(extracurricularFiles.id, rowId));
  await relayDelete(row.fileId);
  await touchSubmission(submissionId, who);
  revalidateEvidence("/course-schedule", who);
  return { ok: true };
}

export async function saveExtracurricularNotes(notes: string, student = ""): Promise<ActionResult> {
  const who = await requireStudent(student);
  if ("error" in who) return { ok: false, error: who.error };

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  await db
    .update(submissions)
    .set({ extracurricularNotes: notes.slice(0, 2000), ...editStamp(who) })
    .where(eq(submissions.id, submissionId));
  revalidateEvidence("/course-schedule", who);
  return { ok: true };
}

export async function addTravelRequest(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf(formData));
  if ("error" in who) return { ok: false, error: who.error };

  // The cutoff (PLAN §8) binds students under the admin-set late policy:
  // "refuse" (the default) stores nothing on/after the cutoff, so every entry
  // is excused; "accept-and-flag" keeps accepting but stores the entry
  // unexcused (late). An admin adding an entry for them IS the excusal call, so
  // the cutoff doesn't stop it and the entry is stored excused either way.
  const now = new Date();
  const [{ cutoff }, policy] = await Promise.all([getTravelCutoff(now), getLateTravelPolicy()]);
  const decision = decideTravelSubmission(now, cutoff, policy);
  if (!decision.allowed && !who.onBehalf) {
    return {
      ok: false,
      error: `The travel deadline (${cutoff.toLocaleDateString()}) has passed. New travel can no longer be added.`,
    };
  }
  const excused = who.onBehalf || (decision.allowed && decision.excused);

  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500) || null;
  if (!startDate || !endDate) return { ok: false, error: "Enter both a start and end date." };
  if (endDate < startDate) return { ok: false, error: "End date can't be before the start date." };

  // Proof stays required of students. An admin recording an excusal for someone
  // IS the excusal, so they may enter one with nothing attached; an untouched
  // file input still submits an empty File, so size decides, not presence.
  const file = formData.get("file");
  const hasProof = file instanceof File && file.size > 0;
  const upload = hasProof || !who.onBehalf ? await readUpload(formData) : null;
  if (upload && "error" in upload) return { ok: false, error: upload.error };

  // Cap before relaying so a rejected upload never orphans a Drive file.
  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  const travelCount = await db
    .select({ n: sql<number>`count(*)` })
    .from(travelRequests)
    .where(eq(travelRequests.submissionId, submissionId));
  if (isAtEvidenceCap(Number(travelCount[0]?.n ?? 0), MAX_TRAVEL_REQUESTS)) {
    return {
      ok: false,
      error: `You can add at most ${MAX_TRAVEL_REQUESTS} travel requests. Remove one to add another.`,
    };
  }

  try {
    const proofFileId = upload
      ? await relayUpload({ studentEmail: who.email, kind: "travel", ...upload })
      : null;
    await db.insert(travelRequests).values({
      id: randomUUID(),
      submissionId,
      proofFileId,
      startDate: calendarDate(startDate),
      endDate: calendarDate(endDate),
      note,
      excused,
    });
    await touchSubmission(submissionId, who);
    revalidateEvidence("/travel", who);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

/**
 * Change an existing entry's dates or note, leaving its proof and its `excused`
 * standing alone: the proof is the evidence for the trip and `excused` records
 * how the entry arrived relative to the cutoff, neither of which a correction to
 * the dates should quietly rewrite. Swap a proof by removing the entry and
 * adding it again.
 */
export async function updateTravelRequest(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf(formData));
  if ("error" in who) return { ok: false, error: who.error };

  // Same cutoff rule as adding: it binds the student, and an admin correcting an
  // entry for them is the excusal call, so it does not bind the admin.
  if (!(await travelUnlocked(who))) {
    return { ok: false, error: "The travel deadline has passed. Travel entries are locked." };
  }

  const id = String(formData.get("id") ?? "");
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500) || null;
  if (!startDate || !endDate) return { ok: false, error: "Enter both a start and end date." };
  if (endDate < startDate) return { ok: false, error: "End date can't be before the start date." };

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  // Existence is checked directly rather than through affectedRows, which counts
  // CHANGED rows: saving the box without touching a field would otherwise come
  // back as "Entry not found". Both statements are scoped to this student's
  // submission, so an id belonging to someone else cannot be edited through it.
  const [row] = await db
    .select({ id: travelRequests.id })
    .from(travelRequests)
    .where(and(eq(travelRequests.id, id), eq(travelRequests.submissionId, submissionId)))
    .limit(1);
  if (!row) return { ok: false, error: "Entry not found." };

  await db
    .update(travelRequests)
    .set({ startDate: calendarDate(startDate), endDate: calendarDate(endDate), note })
    .where(and(eq(travelRequests.id, id), eq(travelRequests.submissionId, submissionId)));

  await touchSubmission(submissionId, who);
  revalidateEvidence("/travel", who);
  return { ok: true };
}

/**
 * Under the "refuse" policy travel locks entirely after the cutoff, removal and
 * edits too, since a removed entry could never be re-added. Under
 * "accept-and-flag" entries stay addable (as late), so both stay open with them.
 * An admin acting on behalf is never locked out: the deadline is a rule for
 * students, and fixing what a student handed in is the admin's job after it.
 */
async function travelUnlocked(who: { onBehalf: boolean }): Promise<boolean> {
  if (who.onBehalf) return true;
  const now = new Date();
  const [{ cutoff }, policy] = await Promise.all([getTravelCutoff(now), getLateTravelPolicy()]);
  return decideTravelSubmission(now, cutoff, policy).allowed;
}

export async function removeTravelRequest(id: string, onBehalfOf?: string): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf);
  if ("error" in who) return { ok: false, error: who.error };

  if (!(await travelUnlocked(who))) {
    return { ok: false, error: "The travel deadline has passed. Travel entries are locked." };
  }

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  const [row] = await db
    .select({ proofFileId: travelRequests.proofFileId })
    .from(travelRequests)
    .where(and(eq(travelRequests.id, id), eq(travelRequests.submissionId, submissionId)))
    .limit(1);
  if (!row) return { ok: false, error: "Entry not found." };

  await db.delete(travelRequests).where(eq(travelRequests.id, id));
  // An admin-entered entry can have no proof, so there may be nothing to clean up.
  if (row.proofFileId) await relayDelete(row.proofFileId);
  await touchSubmission(submissionId, who);
  revalidateEvidence("/travel", who);
  return { ok: true };
}
