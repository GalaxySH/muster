/**
 * Server-side data loading for the availability form (PLAN.md §7).
 * Resolves the signed-in student → position → blocks → existing draft.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, shiftBlocks, submissions, shiftSelections } from "@/lib/db/schema";
import { toDomainPosition, toDomainBlock } from "@/lib/db/mappers";
import { findStudentByEmail, type StudentRecord } from "@/lib/roster/lookup";
import type { Position, ShiftBlock, SelectedShift } from "@/lib/domain/types";

export interface PositionWithBlocks {
  position: Position;
  blocks: ShiftBlock[];
}

/** Load a position and its blocks (authoritative copy used by the save action). */
export async function loadPositionWithBlocks(
  positionId: string,
): Promise<PositionWithBlocks | null> {
  const db = getDb();
  const [posRow] = await db.select().from(positions).where(eq(positions.id, positionId)).limit(1);
  if (!posRow) return null;
  const blockRows = await db
    .select()
    .from(shiftBlocks)
    .where(eq(shiftBlocks.positionId, positionId));
  return { position: toDomainPosition(posRow), blocks: blockRows.map(toDomainBlock) };
}

export interface ExistingSubmission {
  id: string;
  status: "draft" | "submitted";
  everyWeekendOptIn: boolean;
  desiredHours: number | null;
  submittedAt: Date | null;
}

export interface StudentForm {
  student: StudentRecord;
  position: Position | null;
  blocks: ShiftBlock[];
  submission: ExistingSubmission | null;
  selection: SelectedShift[];
}

/**
 * Everything the form route needs. Returns null when the user has no roster
 * record (off-roster — onboarding handled separately).
 */
export async function loadStudentForm(email: string): Promise<StudentForm | null> {
  const student = await findStudentByEmail(email);
  if (!student) return null;

  if (!student.positionId) {
    return { student, position: null, blocks: [], submission: null, selection: [] };
  }

  const db = getDb();
  const posWithBlocks = await loadPositionWithBlocks(student.positionId);

  const [subRow] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.studentEmail, student.email))
    .limit(1);

  let selection: SelectedShift[] = [];
  let submission: ExistingSubmission | null = null;
  if (subRow) {
    submission = {
      id: subRow.id,
      status: subRow.status,
      everyWeekendOptIn: subRow.everyWeekendOptIn,
      desiredHours: subRow.desiredHours,
      submittedAt: subRow.submittedAt,
    };
    const selRows = await db
      .select()
      .from(shiftSelections)
      .where(eq(shiftSelections.submissionId, subRow.id));
    selection = selRows.map((r) => ({ blockId: r.shiftBlockId, day: r.day }));
  }

  return {
    student,
    position: posWithBlocks?.position ?? null,
    blocks: posWithBlocks?.blocks ?? [],
    submission,
    selection,
  };
}
