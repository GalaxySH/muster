/**
 * Server-side data for the evidence pages (PLAN.md §7b). Resolves a student's
 * submission and its evidence artifacts (Drive fileIds only — never bytes), and
 * answers the proxy's "may this student see this fileId?" question.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { submissions, extracurricularFiles, travelRequests } from "@/lib/db/schema";

export interface ExtracurricularFile {
  id: string;
  fileId: string;
}

export interface TravelEntry {
  id: string;
  proofFileId: string;
  startDate: string; // ISO yyyy-mm-dd
  endDate: string;
  note: string | null;
  excused: boolean;
}

export interface EvidenceView {
  submissionId: string | null;
  courseScheduleFileId: string | null;
  extracurricularNotes: string;
  extracurricularFiles: ExtracurricularFile[];
  travel: TravelEntry[];
}

const toIsoDate = (d: Date | string): string =>
  typeof d === "string" ? d : d.toISOString().slice(0, 10);

export async function loadEvidence(studentEmail: string): Promise<EvidenceView> {
  const db = getDb();
  const [sub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.studentEmail, studentEmail))
    .limit(1);

  if (!sub) {
    return {
      submissionId: null,
      courseScheduleFileId: null,
      extracurricularNotes: "",
      extracurricularFiles: [],
      travel: [],
    };
  }

  const ecFiles = await db
    .select({ id: extracurricularFiles.id, fileId: extracurricularFiles.fileId })
    .from(extracurricularFiles)
    .where(eq(extracurricularFiles.submissionId, sub.id));

  const travelRows = await db
    .select()
    .from(travelRequests)
    .where(eq(travelRequests.submissionId, sub.id));

  return {
    submissionId: sub.id,
    courseScheduleFileId: sub.courseScheduleFileId ?? null,
    extracurricularNotes: sub.extracurricularNotes ?? "",
    extracurricularFiles: ecFiles,
    travel: travelRows.map((t) => ({
      id: t.id,
      proofFileId: t.proofFileId,
      startDate: toIsoDate(t.startDate),
      endDate: toIsoDate(t.endDate),
      note: t.note ?? null,
      excused: t.excused,
    })),
  };
}

/** Load or create the student's (draft) submission and return its id. */
export async function ensureSubmissionId(studentEmail: string): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, studentEmail))
    .limit(1);
  if (existing) return existing.id;

  const id = randomUUID();
  await db.insert(submissions).values({ id, studentEmail, status: "draft" });
  return id;
}

/**
 * Whether a fileId belongs to this student's submission — the proxy's access
 * gate for non-admins. Checks course schedule, extracurricular, and travel proof.
 */
export async function studentOwnsFile(studentEmail: string, fileId: string): Promise<boolean> {
  const db = getDb();
  const [sub] = await db
    .select({ id: submissions.id, courseScheduleFileId: submissions.courseScheduleFileId })
    .from(submissions)
    .where(eq(submissions.studentEmail, studentEmail))
    .limit(1);
  if (!sub) return false;
  if (sub.courseScheduleFileId === fileId) return true;

  const [ec] = await db
    .select({ id: extracurricularFiles.id })
    .from(extracurricularFiles)
    .where(
      and(eq(extracurricularFiles.submissionId, sub.id), eq(extracurricularFiles.fileId, fileId)),
    )
    .limit(1);
  if (ec) return true;

  const [tr] = await db
    .select({ id: travelRequests.id })
    .from(travelRequests)
    .where(and(eq(travelRequests.submissionId, sub.id), eq(travelRequests.proofFileId, fileId)))
    .limit(1);
  return Boolean(tr);
}
