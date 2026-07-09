/**
 * Server-side data loading for the availability form (PLAN.md §7).
 * Resolves the signed-in student → position → blocks → existing draft.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, shiftBlocks, students, submissions, shiftSelections } from "@/lib/db/schema";
import { toDomainPosition, toDomainBlock } from "@/lib/db/mappers";
import { findStudentByEmail, type StudentRecord } from "@/lib/roster/lookup";
import { highDemandCells, DEMAND_MIN_RESPONDERS, type CellCount } from "@/lib/domain/demand";
import type { Day, Position, ShiftBlock, SelectedShift } from "@/lib/domain/types";

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

/**
 * (block × day) cells to flag as high-demand in a position's grid (roadmap 2.5):
 * computed from submitted responders' own picks (auto-assigned cells excluded),
 * off-roster and test accounts excluded. Empty until the position clears the responder
 * floor, so the signal never shows on a thin cohort. Runs at grid load (~cheap, two
 * queries). Keys are `demandCellKey(blockId, day)`.
 */
export async function loadHighDemandCells(positionId: string): Promise<Set<string>> {
  const db = getDb();
  const [rc] = await db
    .select({ n: sql<number>`count(*)` })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(
      and(
        eq(students.positionId, positionId),
        eq(students.onRoster, true),
        eq(submissions.status, "submitted"),
      ),
    );
  const responderCount = Number(rc?.n ?? 0);
  if (responderCount < DEMAND_MIN_RESPONDERS) return new Set();

  const rows = await db
    .select({
      blockId: shiftSelections.shiftBlockId,
      day: shiftSelections.day,
      count: sql<number>`count(distinct ${shiftSelections.submissionId})`,
    })
    .from(shiftSelections)
    .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(
      and(
        eq(students.positionId, positionId),
        eq(students.onRoster, true),
        eq(submissions.status, "submitted"),
        // Machine-assigned weekend cells aren't preferences; don't count them.
        eq(shiftSelections.autoAssigned, false),
      ),
    )
    .groupBy(shiftSelections.shiftBlockId, shiftSelections.day);

  const counts: CellCount[] = rows.map((r) => ({
    blockId: r.blockId,
    day: r.day as Day,
    count: Number(r.count),
  }));
  return highDemandCells(counts, responderCount);
}

export interface ExistingSubmission {
  id: string;
  status: "draft" | "submitted";
  everyWeekendOptIn: boolean;
  desiredHours: number | null;
  studentNotes: string;
  submittedAt: Date | null;
}

export interface StudentForm {
  student: StudentRecord;
  position: Position | null;
  blocks: ShiftBlock[];
  submission: ExistingSubmission | null;
  /** The student's own picks (machine-chosen cells are kept out). */
  selection: SelectedShift[];
  /** Weekend cell(s) auto-assigned on submit (PLAN §5 #5); display-only overlay. */
  autoAssigned: SelectedShift[];
}

/**
 * Everything the form route needs. Returns null when the user has no roster
 * record (off-roster; onboarding handled separately).
 */
export async function loadStudentForm(email: string): Promise<StudentForm | null> {
  const student = await findStudentByEmail(email);
  if (!student) return null;

  if (!student.positionId) {
    return {
      student,
      position: null,
      blocks: [],
      submission: null,
      selection: [],
      autoAssigned: [],
    };
  }

  const db = getDb();
  const posWithBlocks = await loadPositionWithBlocks(student.positionId);

  const [subRow] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.studentEmail, student.email))
    .limit(1);

  let selection: SelectedShift[] = [];
  let autoAssigned: SelectedShift[] = [];
  let submission: ExistingSubmission | null = null;
  if (subRow) {
    submission = {
      id: subRow.id,
      status: subRow.status,
      everyWeekendOptIn: subRow.everyWeekendOptIn,
      desiredHours: subRow.desiredHours,
      studentNotes: subRow.studentNotes ?? "",
      submittedAt: subRow.submittedAt,
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
  }

  return {
    student,
    position: posWithBlocks?.position ?? null,
    blocks: posWithBlocks?.blocks ?? [],
    submission,
    selection,
    autoAssigned,
  };
}
