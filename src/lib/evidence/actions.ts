"use server";

/**
 * Evidence upload/save actions (PLAN.md §7b, §12). Each relays bytes to Drive
 * and persists only the returned fileId (or text). The server is the authority:
 * it re-validates the file, owns the student↔submission link, and never writes
 * image bytes to the app's storage.
 *
 * Every action also runs for an admin acting **on behalf of** a student (the
 * target email rides in the FormData `student` field, or a second argument for
 * the ones that don't take FormData); `requireEditableStudent` admin-gates it.
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
import { getTravelCutoff } from "@/lib/settings";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

interface Target {
  email: string;
  /** True when an admin is filling this in for the student (skips the window gates). */
  onBehalf: boolean;
}

// Gates every mutating evidence action on the shared student gate (PLAN §13):
// roster + group + open window. Uploading/removing evidence is part of editing
// the submission, so it locks with the form. An admin may pass a target student
// to act for; the gate refuses that for everyone else.
async function requireStudent(onBehalfOf?: string): Promise<Target | { error: string }> {
  const gate = await requireEditableStudent(onBehalfOf);
  return gate.ok ? { email: gate.email, onBehalf: gate.onBehalf } : { error: gate.error };
}

/** The on-behalf target an admin form carries (empty for the student's own form). */
const targetOf = (formData: FormData): string => String(formData.get("student") ?? "").trim();

/** Refresh the student page that changed, plus the admin's view of that student. */
function revalidateFor(who: Target, path: string): void {
  revalidatePath(path);
  if (who.onBehalf) revalidatePath(`/admin/students/${encodeURIComponent(who.email)}`);
}

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
  const who = await requireStudent(targetOf(formData));
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
      .set({ courseScheduleFileId: fileId })
      .where(eq(submissions.id, submissionId));
    if (prev?.courseScheduleFileId) await relayDelete(prev.courseScheduleFileId);
    revalidateFor(who, "/course-schedule");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

export async function addExtracurricularFile(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent(targetOf(formData));
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
    revalidateFor(who, "/course-schedule");
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
  revalidateFor(who, "/course-schedule");
  return { ok: true };
}

export async function saveExtracurricularNotes(
  notes: string,
  onBehalfOf?: string,
): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf);
  if ("error" in who) return { ok: false, error: who.error };

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  await db
    .update(submissions)
    .set({ extracurricularNotes: notes.slice(0, 2000) })
    .where(eq(submissions.id, submissionId));
  revalidateFor(who, "/course-schedule");
  return { ok: true };
}

export async function addTravelRequest(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent(targetOf(formData));
  if ("error" in who) return { ok: false, error: who.error };

  // The cutoff hard stop (PLAN §8): under the active "refuse" policy, nothing
  // is stored on/after the cutoff, so every stored entry is excused.
  const now = new Date();
  const { cutoff } = await getTravelCutoff(now);
  const decision = decideTravelSubmission(now, cutoff);
  if (!decision.allowed) {
    return {
      ok: false,
      error: `The travel deadline (${cutoff.toLocaleDateString()}) has passed. New travel can no longer be added.`,
    };
  }

  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500) || null;
  if (!startDate || !endDate) return { ok: false, error: "Enter both a start and end date." };
  if (endDate < startDate) return { ok: false, error: "End date can't be before the start date." };

  const upload = await readUpload(formData);
  if ("error" in upload) return { ok: false, error: upload.error };

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
    const proofFileId = await relayUpload({ studentEmail: who.email, kind: "travel", ...upload });
    await db.insert(travelRequests).values({
      id: randomUUID(),
      submissionId,
      proofFileId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      note,
      excused: decision.excused,
    });
    revalidateFor(who, "/travel");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

export async function removeTravelRequest(id: string, onBehalfOf?: string): Promise<ActionResult> {
  const who = await requireStudent(onBehalfOf);
  if ("error" in who) return { ok: false, error: who.error };

  // Travel is locked entirely after the cutoff, removal too, since a removed
  // entry could never be re-added under the "refuse" policy.
  const now = new Date();
  const { cutoff } = await getTravelCutoff(now);
  if (!decideTravelSubmission(now, cutoff).allowed) {
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
  await relayDelete(row.proofFileId);
  revalidateFor(who, "/travel");
  return { ok: true };
}
