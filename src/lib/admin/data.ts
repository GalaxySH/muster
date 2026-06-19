/**
 * Server-side data for the admin surfaces (PLAN.md §10, §10a).
 *
 * The per-student view is the primary admin surface: it pulls a student's
 * roster record, position config, submission, selection (split into the
 * student's own picks vs. the machine-assigned weekend cell), persisted flags,
 * and evidence (Drive fileIds only — never bytes, via the evidence loader).
 *
 * The response list is the navigation hub; it also defines the stable ordering
 * the per-student prev/next nav walks (PLAN §10 "fast prev/next" — hard req).
 */
import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  positions,
  shiftBlocks,
  students,
  submissions,
  shiftSelections,
  flags,
} from "@/lib/db/schema";
import { toDomainPosition, toDomainBlock } from "@/lib/db/mappers";
import { normalizeEmail } from "@/lib/auth/policy";
import { loadEvidence, type EvidenceView } from "@/lib/evidence/data";
import type { Position, ShiftBlock, SelectedShift } from "@/lib/domain/types";
import type { FlagType } from "@/lib/domain/validation";

export interface StudentDetail {
  email: string;
  displayName: string;
  international: boolean;
  onRoster: boolean;
  position: Position | null;
  blocks: ShiftBlock[];
  submission: {
    id: string;
    status: "draft" | "submitted";
    everyWeekendOptIn: boolean;
    desiredHours: number | null;
    submittedAt: Date | null;
    updatedAt: Date;
    scheduled: boolean;
    schedulerNotes: string;
  } | null;
  /** The student's own picks (machine-assigned cells excluded). */
  selection: SelectedShift[];
  /** Weekend cell(s) auto-assigned on submit (PLAN §5 #5). */
  autoAssigned: SelectedShift[];
  flags: { type: FlagType; detail: string }[];
  evidence: EvidenceView;
}

/** Everything the per-student view needs, or null if no such student. */
export async function loadStudentDetail(emailRaw: string): Promise<StudentDetail | null> {
  const db = getDb();
  const email = normalizeEmail(emailRaw);

  const [student] = await db.select().from(students).where(eq(students.email, email)).limit(1);
  if (!student) return null;

  let position: Position | null = null;
  let blocks: ShiftBlock[] = [];
  if (student.positionId) {
    const [posRow] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, student.positionId))
      .limit(1);
    if (posRow) {
      position = toDomainPosition(posRow);
      const blockRows = await db
        .select()
        .from(shiftBlocks)
        .where(eq(shiftBlocks.positionId, student.positionId));
      blocks = blockRows.map(toDomainBlock);
    }
  }

  const [subRow] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);

  let selection: SelectedShift[] = [];
  let autoAssigned: SelectedShift[] = [];
  let flagRows: { type: FlagType; detail: string }[] = [];
  let submission: StudentDetail["submission"] = null;

  if (subRow) {
    submission = {
      id: subRow.id,
      status: subRow.status,
      everyWeekendOptIn: subRow.everyWeekendOptIn,
      desiredHours: subRow.desiredHours,
      submittedAt: subRow.submittedAt,
      updatedAt: subRow.updatedAt,
      scheduled: subRow.scheduled,
      schedulerNotes: subRow.schedulerNotes ?? "",
    };

    const selRows = await db
      .select()
      .from(shiftSelections)
      .where(eq(shiftSelections.submissionId, subRow.id));
    selection = selRows
      .filter((r) => !r.autoAssigned)
      .map((r) => ({ blockId: r.shiftBlockId, day: r.day }));
    autoAssigned = selRows
      .filter((r) => r.autoAssigned)
      .map((r) => ({ blockId: r.shiftBlockId, day: r.day }));

    const fRows = await db
      .select({ type: flags.type, detail: flags.detail })
      .from(flags)
      .where(eq(flags.submissionId, subRow.id));
    flagRows = fRows.map((f) => ({ type: f.type, detail: f.detail ?? "" }));
  }

  const evidence = await loadEvidence(email);

  return {
    email: student.email,
    displayName: student.displayName,
    international: student.international,
    onRoster: student.onRoster,
    position,
    blocks,
    submission,
    selection,
    autoAssigned,
    flags: flagRows,
    evidence,
  };
}

export interface ResponseRow {
  email: string;
  displayName: string;
  positionId: string | null;
  positionName: string | null;
  status: "draft" | "submitted";
  scheduled: boolean;
  desiredHours: number | null;
  flagCount: number;
  submittedAt: Date | null;
  updatedAt: Date;
}

/**
 * All responders (anyone with a submission), in the canonical nav order:
 * by display name, then email. This ordering is the source of truth for the
 * per-student prev/next walk.
 */
export async function listResponses(): Promise<ResponseRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      email: submissions.studentEmail,
      displayName: students.displayName,
      positionId: students.positionId,
      positionName: positions.name,
      status: submissions.status,
      scheduled: submissions.scheduled,
      desiredHours: submissions.desiredHours,
      submittedAt: submissions.submittedAt,
      updatedAt: submissions.updatedAt,
    })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .leftJoin(positions, eq(students.positionId, positions.id))
    .orderBy(asc(students.displayName), asc(submissions.studentEmail));

  // One follow-up query for flag counts keyed by submission, avoiding a GROUP BY
  // round-trip per row. (Response volume is ~400; a single IN is fine.)
  const subIds = await db
    .select({ id: submissions.id, email: submissions.studentEmail })
    .from(submissions);
  const idByEmail = new Map(subIds.map((s) => [s.email, s.id]));
  const allFlags = subIds.length
    ? await db
        .select({ submissionId: flags.submissionId })
        .from(flags)
        .where(
          inArray(
            flags.submissionId,
            subIds.map((s) => s.id),
          ),
        )
    : [];
  const flagCountBySub = new Map<string, number>();
  for (const f of allFlags) {
    flagCountBySub.set(f.submissionId, (flagCountBySub.get(f.submissionId) ?? 0) + 1);
  }

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionId: r.positionId,
    positionName: r.positionName,
    status: r.status,
    scheduled: r.scheduled,
    desiredHours: r.desiredHours,
    flagCount: flagCountBySub.get(idByEmail.get(r.email) ?? "") ?? 0,
    submittedAt: r.submittedAt,
    updatedAt: r.updatedAt,
  }));
}

export interface ResponseNeighbors {
  /** 1-based position in the response list, or 0 if the email isn't a responder. */
  index: number;
  total: number;
  prevEmail: string | null;
  nextEmail: string | null;
}

/** Prev/next email + position for the identity header nav (PLAN §10a). */
export async function getResponseNeighbors(emailRaw: string): Promise<ResponseNeighbors> {
  const email = normalizeEmail(emailRaw);
  const list = await listResponses();
  const i = list.findIndex((r) => r.email === email);
  if (i === -1) {
    return { index: 0, total: list.length, prevEmail: null, nextEmail: null };
  }
  return {
    index: i + 1,
    total: list.length,
    prevEmail: i > 0 ? list[i - 1]!.email : null,
    nextEmail: i < list.length - 1 ? list[i + 1]!.email : null,
  };
}
