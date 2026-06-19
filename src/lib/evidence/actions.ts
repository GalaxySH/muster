"use server";

/**
 * Evidence upload/save actions (PLAN.md §7b, §12). Each relays bytes to Drive
 * and persists only the returned fileId (or text). The server is the authority:
 * it re-validates the file, owns the student↔submission link, and never writes
 * image bytes to the app's storage.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions, extracurricularFiles, travelRequests } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { validateEvidenceUpload } from "@/lib/drive/upload-validation";
import { relayUpload, relayDelete, NoDriveGrantError } from "@/lib/drive/relay";
import { ensureSubmissionId } from "./data";
import { isTravelExcused, defaultTravelCutoff } from "@/lib/domain/travel";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireStudent(): Promise<{ email: string } | { error: string }> {
  const session = await getAppSession();
  if (!session) return { error: "You are not signed in." };
  const student = await findStudentByEmail(session.email);
  if (!student) return { error: "You are not on the roster." };
  return { email: student.email };
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

export async function uploadCourseSchedule(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent();
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
    revalidatePath("/evidence");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

export async function addExtracurricularFile(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent();
  if ("error" in who) return { ok: false, error: who.error };
  const upload = await readUpload(formData);
  if ("error" in upload) return { ok: false, error: upload.error };

  try {
    const fileId = await relayUpload({
      studentEmail: who.email,
      kind: "extracurricular",
      ...upload,
    });
    const db = getDb();
    const submissionId = await ensureSubmissionId(who.email);
    await db.insert(extracurricularFiles).values({ id: randomUUID(), submissionId, fileId });
    revalidatePath("/evidence");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

export async function removeExtracurricularFile(rowId: string): Promise<ActionResult> {
  const who = await requireStudent();
  if ("error" in who) return { ok: false, error: who.error };

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  const [row] = await db
    .select({ fileId: extracurricularFiles.fileId })
    .from(extracurricularFiles)
    .where(and(eq(extracurricularFiles.id, rowId), eq(extracurricularFiles.submissionId, submissionId)))
    .limit(1);
  if (!row) return { ok: false, error: "File not found." };

  await db.delete(extracurricularFiles).where(eq(extracurricularFiles.id, rowId));
  await relayDelete(row.fileId);
  revalidatePath("/evidence");
  return { ok: true };
}

export async function saveExtracurricularNotes(notes: string): Promise<ActionResult> {
  const who = await requireStudent();
  if ("error" in who) return { ok: false, error: who.error };

  const db = getDb();
  const submissionId = await ensureSubmissionId(who.email);
  await db
    .update(submissions)
    .set({ extracurricularNotes: notes.slice(0, 2000) })
    .where(eq(submissions.id, submissionId));
  revalidatePath("/evidence");
  return { ok: true };
}

export async function addTravelRequest(formData: FormData): Promise<ActionResult> {
  const who = await requireStudent();
  if ("error" in who) return { ok: false, error: who.error };

  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500) || null;
  if (!startDate || !endDate) return { ok: false, error: "Enter both a start and end date." };
  if (endDate < startDate) return { ok: false, error: "End date can't be before the start date." };

  const upload = await readUpload(formData);
  if ("error" in upload) return { ok: false, error: upload.error };

  try {
    const proofFileId = await relayUpload({ studentEmail: who.email, kind: "travel", ...upload });
    const now = new Date();
    const excused = isTravelExcused(now, defaultTravelCutoff(now));
    const db = getDb();
    const submissionId = await ensureSubmissionId(who.email);
    await db.insert(travelRequests).values({
      id: randomUUID(),
      submissionId,
      proofFileId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      note,
      excused,
    });
    revalidatePath("/evidence");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: relayError(e) };
  }
}

export async function removeTravelRequest(id: string): Promise<ActionResult> {
  const who = await requireStudent();
  if ("error" in who) return { ok: false, error: who.error };

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
  revalidatePath("/evidence");
  return { ok: true };
}
