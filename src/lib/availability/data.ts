/**
 * Server-side data loading for the availability form (PLAN.md §7).
 * Resolves the signed-in student → position → blocks → existing draft.
 */
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, shiftBlocks, students, submissions, shiftSelections } from "@/lib/db/schema";
import { toDomainPosition, toDomainBlock } from "@/lib/db/mappers";
import { findStudentByEmail, type StudentRecord } from "@/lib/roster/lookup";
import { highDemandCells, type CellCount } from "@/lib/domain/demand";
import { partitionSelection } from "@/lib/domain/orphans";
import type { Day, Position, ShiftBlock, SelectedShift } from "@/lib/domain/types";

export interface PositionWithBlocks {
  position: Position;
  blocks: ShiftBlock[];
}

/**
 * Load a position and its LIVE blocks (authoritative copy used by the save
 * action). Retired blocks are left out everywhere a block set drives behavior:
 * they are gone as far as students, the rules, and the generator are concerned,
 * and picks left on them are orphaned (lib/positions/orphans.ts).
 */
export async function loadPositionWithBlocks(
  positionId: string,
): Promise<PositionWithBlocks | null> {
  const db = getDb();
  const [posRow] = await db.select().from(positions).where(eq(positions.id, positionId)).limit(1);
  if (!posRow) return null;
  const blockRows = await db
    .select()
    .from(shiftBlocks)
    .where(and(eq(shiftBlocks.positionId, positionId), isNull(shiftBlocks.retiredAt)));
  return { position: toDomainPosition(posRow), blocks: blockRows.map(toDomainBlock) };
}

/**
 * (block × day) cells to flag as high-demand in a position's grid (roadmap 2.5):
 * computed from submitted responders' own picks (auto-assigned cells excluded),
 * off-roster and test accounts excluded.
 *
 * PROTOTYPE (branch high-demand-review): no cohort-size floor. Each cell is gated
 * against its own block target (desiredCapacity); a cell shows only once it has at
 * least its target number of takers. See domain/demand.ts. Runs at grid load
 * (~cheap, two queries). Keys are `demandCellKey(blockId, day)`.
 */
export async function loadHighDemandCells(positionId: string): Promise<Set<string>> {
  const db = getDb();
  // Per-block target staffing, to floor each cell individually.
  const blockRows = await db
    .select({ id: shiftBlocks.id, target: shiftBlocks.desiredCapacity })
    .from(shiftBlocks)
    .where(and(eq(shiftBlocks.positionId, positionId), isNull(shiftBlocks.retiredAt)));
  const targets = new Map<string, number | null>(blockRows.map((b) => [b.id, b.target ?? null]));

  const rows = await db
    .select({
      blockId: shiftSelections.shiftBlockId,
      day: shiftSelections.day,
      count: sql<number>`count(distinct ${shiftSelections.submissionId})`,
    })
    .from(shiftSelections)
    .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    // Join the block so picks on a removed shift can't be counted. They render
    // nowhere, but an uncounted target would let them into the contention
    // ranking and push a genuinely busy cell out of it.
    .innerJoin(shiftBlocks, eq(shiftSelections.shiftBlockId, shiftBlocks.id))
    .where(
      and(
        eq(students.positionId, positionId),
        eq(students.onRoster, true),
        eq(submissions.status, "submitted"),
        // Machine-assigned weekend cells aren't preferences; don't count them.
        eq(shiftSelections.autoAssigned, false),
        isNull(shiftBlocks.retiredAt),
      ),
    )
    .groupBy(shiftSelections.shiftBlockId, shiftSelections.day);

  const counts: CellCount[] = rows.map((r) => ({
    blockId: r.blockId,
    day: r.day as Day,
    count: Number(r.count),
  }));
  return highDemandCells(counts, { targets });
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
    // Picks on a removed shift are dropped here, before anything downstream
    // sees them: this feeds the wizard's validateAvailability, and
    // computeCapacity throws on a block it can't resolve. Students never see
    // an orphaned pick, so there is nothing for them to act on either.
    const blocks = posWithBlocks?.blocks ?? [];
    selection = partitionSelection(
      selRows.filter((r) => !r.autoAssigned).map((r) => ({ blockId: r.shiftBlockId, day: r.day })),
      blocks,
    ).known;
    autoAssigned = partitionSelection(
      selRows.filter((r) => r.autoAssigned).map((r) => ({ blockId: r.shiftBlockId, day: r.day })),
      blocks,
    ).known;
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
