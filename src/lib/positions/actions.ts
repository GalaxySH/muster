"use server";

/**
 * Admin-only mutations for the positions/blocks config (roadmap 3.3). All
 * admin-gated. Lifecycle guards live here: Shift Lead is protected (the §18a
 * close-claims gating string-compares its id), a referenced position refuses
 * deletion, and alias switches + ghost resolutions run the shared
 * position-change routine (selection carry-over, position_change flag,
 * revalidation) per moved student inside one transaction.
 *
 * Block lifecycle (PLAN §6.2a): a picked block can't be deleted, so removing
 * one RETIRES it and orphans the picks; a time edit keeps the picks on the
 * block (they follow it to the new hours) and re-runs their checks, since the
 * shift just moved under them. Both keep the orphan and revalidation flags in
 * step for every affected student.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { liveBlocksOnly } from "@/lib/db/blocks";
import {
  positions,
  internalSelections,
  rosterTitleMappings,
  scheduleAssignments,
  shiftBlocks,
  shiftSelections,
  students,
  w2wPositionMap,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { validateBlockTimes, validateDesiredCapacity } from "@/lib/domain/config-validation";
import { canAliasTo } from "@/lib/domain/position-alias";
import type { DayType } from "@/lib/domain/types";
import { normalizeTitle } from "@/lib/roster/position-mapping";
import {
  applyPositionChange,
  resolveDeferredCarryOver,
  syncRevalidationFlag,
  type DbTx,
} from "./apply-change";
import { syncOrphanFlagsForBlocks } from "./orphans";
import { POSITION_NAME_MAX, slugifyPositionId } from "./slug";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** New positions start at the standard 10h / 2-day floor (PLAN §6.1). */
const NEW_POSITION_DEFAULTS = { minHours: 10, minDays: 2, weekendExempt: false, active: true };

function revalidatePositions() {
  revalidatePath("/admin/positions");
}

/** Paths that render flags, pills, or a student's position (alias/ghost moves). */
function revalidateStudentSurfaces() {
  revalidatePath("/availability");
  revalidatePath("/admin/responses");
  revalidatePath("/admin/non-responses");
}

/**
 * Paths a block change moves. Beyond the config page and the student grid,
 * a block edit can raise or clear flags, so the surfaces that count them
 * (the hub's Needs attention list, the response list) go stale too.
 */
function revalidateBlockSurfaces() {
  revalidatePositions();
  revalidateStudentSurfaces();
  revalidatePath("/admin");
}

/** Every submission with a pick on any of these blocks, in either copy. */
async function submissionsHoldingBlocks(tx: DbTx, blockIds: string[]): Promise<string[]> {
  if (blockIds.length === 0) return [];
  const [own, internal] = await Promise.all([
    tx
      .select({ submissionId: shiftSelections.submissionId })
      .from(shiftSelections)
      .where(inArray(shiftSelections.shiftBlockId, blockIds)),
    tx
      .select({ submissionId: internalSelections.submissionId })
      .from(internalSelections)
      .where(inArray(internalSelections.shiftBlockId, blockIds)),
  ]);
  return [...new Set([...own, ...internal].map((r) => r.submissionId))];
}

/** Re-run the stored-answer checks for everyone holding any of these blocks. */
async function revalidateSubmissionsHolding(tx: DbTx, blockIds: string[]): Promise<number> {
  const ids = await submissionsHoldingBlocks(tx, blockIds);
  for (const id of ids) await syncRevalidationFlag(tx, id);
  return ids.length;
}

function checkName(name: string): { ok: true; name: string } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a position name." };
  if (trimmed.length > POSITION_NAME_MAX) return { ok: false, error: "That name is too long." };
  return { ok: true, name: trimmed };
}

export async function createPosition(name: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const checked = checkName(name);
  if (!checked.ok) return checked;
  const id = slugifyPositionId(checked.name);
  if (!id) return { ok: false, error: "The name needs at least one letter or number." };

  const db = getDb();
  const clash = await db
    .select({ id: positions.id })
    .from(positions)
    .where(or(eq(positions.id, id), eq(positions.name, checked.name)))
    .limit(1);
  if (clash.length > 0) return { ok: false, error: "A position with that name already exists." };

  await db.insert(positions).values({ id, name: checked.name, ...NEW_POSITION_DEFAULTS });
  revalidatePositions();
  return { ok: true };
}

export interface PositionUpdate {
  name: string;
  minHours: number;
  minDays: number;
  weekendExempt: boolean;
  /** ISO date ("YYYY-MM-DD"), or null to clear (hides the return-date card on /travel). */
  returnDate: string | null;
}

/**
 * Validates the "YYYY-MM-DD" a date input sends, or null to clear. Kept and
 * stored as a plain string (never parsed into a JS Date for the DB write):
 * mysql2 serializes Date params using the server's local timezone, which can
 * roll a UTC-intended date back a day.
 */
function checkReturnDate(
  value: string | null,
): { ok: true; date: string | null } | { ok: false; error: string } {
  if (!value) return { ok: true, date: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { ok: false, error: "Enter a valid return date." };
  const [, y, m, d] = match;
  const check = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const real =
    check.getUTCFullYear() === Number(y) &&
    check.getUTCMonth() === Number(m) - 1 &&
    check.getUTCDate() === Number(d);
  if (!real) return { ok: false, error: "Enter a valid return date." };
  return { ok: true, date: value };
}

/** One edited block inside a position save: minutes plus the target staffing. */
export interface BlockEdit {
  blockId: string;
  start: number;
  end: number;
  desiredCapacity: number | null;
}

/**
 * The position card's single Save: the details fields (when edited) and every
 * edited block land together, validated up front and written in one
 * transaction, with one revalidation at the end.
 */
export async function savePosition(
  id: string,
  changes: { details?: PositionUpdate; blockEdits: BlockEdit[] },
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  let details:
    | {
        name: string;
        minHours: number;
        minDays: number;
        weekendExempt: boolean;
        returnDate: string | null;
      }
    | undefined;
  if (changes.details) {
    const checked = checkName(changes.details.name);
    if (!checked.ok) return checked;
    if (!Number.isInteger(changes.details.minHours) || changes.details.minHours < 0) {
      return { ok: false, error: "Minimum hours must be a whole number, 0 or more." };
    }
    if (!Number.isInteger(changes.details.minDays) || changes.details.minDays < 0) {
      return { ok: false, error: "Minimum days must be a whole number, 0 or more." };
    }
    const checkedReturnDate = checkReturnDate(changes.details.returnDate);
    if (!checkedReturnDate.ok) return checkedReturnDate;
    details = { ...changes.details, name: checked.name, returnDate: checkedReturnDate.date };
  }
  for (const edit of changes.blockEdits) {
    const timeError = validateBlockTimes(edit.start, edit.end);
    if (timeError) return { ok: false, error: timeError };
    const capacityError = validateDesiredCapacity(edit.desiredCapacity);
    if (capacityError) return { ok: false, error: capacityError };
  }
  if (!details && changes.blockEdits.length === 0) return { ok: true };

  const db = getDb();
  const [row] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(eq(positions.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "Position not found." };
  if (details) {
    const clash = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.name, details.name), ne(positions.id, id)))
      .limit(1);
    if (clash.length > 0) return { ok: false, error: "A position with that name already exists." };
  }
  const blockIds = changes.blockEdits.map((e) => e.blockId);
  // Which edits actually move a shift's hours, read before the update writes
  // over them. Only these need the students' checks re-run below.
  const retimed: string[] = [];
  if (blockIds.length > 0) {
    const found = await db
      .select({
        id: shiftBlocks.id,
        start: shiftBlocks.startMinutes,
        end: shiftBlocks.endMinutes,
      })
      .from(shiftBlocks)
      // Retired shifts are not editable: restore one before changing its hours.
      .where(
        and(eq(shiftBlocks.positionId, id), inArray(shiftBlocks.id, blockIds), liveBlocksOnly()),
      );
    if (found.length !== new Set(blockIds).size) return { ok: false, error: "Block not found." };
    const before = new Map(found.map((b) => [b.id, b]));
    for (const edit of changes.blockEdits) {
      const was = before.get(edit.blockId);
      if (was && (was.start !== edit.start || was.end !== edit.end)) retimed.push(edit.blockId);
    }
  }

  await db.transaction(async (tx) => {
    if (details) {
      await tx
        .update(positions)
        .set({
          name: details.name,
          minHours: details.minHours,
          minDays: details.minDays,
          weekendExempt: details.weekendExempt,
          returnDate: details.returnDate,
        })
        .where(eq(positions.id, id));
    }
    for (const edit of changes.blockEdits) {
      await tx
        .update(shiftBlocks)
        .set({
          startMinutes: edit.start,
          endMinutes: edit.end,
          desiredCapacity: edit.desiredCapacity,
        })
        .where(eq(shiftBlocks.id, edit.blockId));
    }
    // A time edit moves the shift under everyone who picked it: their picks
    // keep pointing at this block and now mean the new hours, which can drop
    // them under the floor. Re-run their checks so that shows up as a flag
    // instead of silently changing what they agreed to. Staffing-target edits
    // change nothing a student answered, so they don't trigger this.
    await revalidateSubmissionsHolding(tx, retimed);
    // Any orphan flag naming this shift quotes the old hours in its detail.
    await syncOrphanFlagsForBlocks(tx, retimed);
  });

  revalidateBlockSurfaces();
  return { ok: true };
}

export async function setPositionActive(id: string, active: boolean): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const db = getDb();
  const [row] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(eq(positions.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "Position not found." };

  await db.update(positions).set({ active }).where(eq(positions.id, id));
  revalidatePositions();
  return { ok: true };
}

/** Aborts a delete transaction, carrying the refusal the admin should read. */
class DeleteRefused extends Error {}

export async function deletePosition(id: string): Promise<ActionResult> {
  const fail = (error: string): ActionResult => ({ ok: false, error });
  const gate = await requireAdmin();
  if (!gate.ok) return fail(gate.error);
  if (id === SHIFT_LEAD_POSITION_ID) {
    return fail("Shift Lead is built in and can't be deleted.");
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      // Two locking reads, then every guard, then the deletes, all in here. A
      // count taken outside the transaction is only a claim about the past: a
      // schedule generation committing between it and the delete reopens the
      // silent cascade these guards exist to close. InnoDB takes a shared lock
      // on the parent row for every child insert's FK check, so holding the
      // position row and its blocks means nobody can move a student onto the
      // position, or land a pick or a schedule assignment on its blocks, until
      // this commits. Plain counts, even in here, would read a snapshot and
      // leave the same window open.
      const [row] = await tx
        .select({ id: positions.id })
        .from(positions)
        .where(eq(positions.id, id))
        .limit(1)
        .for("update");
      if (!row) throw new DeleteRefused("Position not found.");
      await tx
        .select({ id: shiftBlocks.id })
        .from(shiftBlocks)
        .where(eq(shiftBlocks.positionId, id))
        .for("update");

      const [studentRef] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(students)
        .where(eq(students.positionId, id));
      const studentCount = Number(studentRef?.n ?? 0);
      if (studentCount > 0) {
        throw new DeleteRefused(
          `${studentCount} student${studentCount === 1 ? " still holds" : "s still hold"} this position. Deactivate it instead.`,
        );
      }

      // Both cell tables hold FKs to this position's blocks: the student's own
      // picks and the admin's internal copies (PLAN §10a).
      const [selectionRef] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(shiftSelections)
        .innerJoin(shiftBlocks, eq(shiftSelections.shiftBlockId, shiftBlocks.id))
        .where(eq(shiftBlocks.positionId, id));
      const [internalRef] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(internalSelections)
        .innerJoin(shiftBlocks, eq(internalSelections.shiftBlockId, shiftBlocks.id))
        .where(eq(shiftBlocks.positionId, id));
      if (Number(selectionRef?.n ?? 0) + Number(internalRef?.n ?? 0) > 0) {
        throw new DeleteRefused(
          "Students still have shift picks on this position's blocks. Deactivate it instead.",
        );
      }

      // schedule_assignments cascades off shift_blocks, so deleting this position's
      // blocks would strip shifts out of a saved run with no warning. A run can
      // outlive the picks behind it (an alias move carries selections to the new
      // position but leaves the old run's rows), so this is reachable even though
      // the checks above passed.
      const [assignedRef] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(scheduleAssignments)
        .innerJoin(shiftBlocks, eq(scheduleAssignments.shiftBlockId, shiftBlocks.id))
        .where(eq(shiftBlocks.positionId, id));
      if (Number(assignedRef?.n ?? 0) > 0) {
        throw new DeleteRefused(
          "A saved schedule run still has shifts on this position's blocks. Deactivate it instead.",
        );
      }

      // w2w_position_map points here with no ON DELETE, so it has to be cleared in
      // the same transaction or the delete fails on the FK. The mapping is dead
      // either way once the position is gone. Unlike a roster title mapping (which
      // the next import or a ghost resolution recreates), this is seeded config a
      // plan import needs, so the count is shown in the confirm before the delete
      // rather than reported after it (`listPositionsAdmin` carries it).
      await tx.delete(w2wPositionMap).where(eq(w2wPositionMap.musterPositionId, id));
      await tx.delete(rosterTitleMappings).where(eq(rosterTitleMappings.positionId, id));
      await tx.delete(shiftBlocks).where(eq(shiftBlocks.positionId, id));
      await tx.delete(positions).where(eq(positions.id, id));
    });
  } catch (e) {
    if (e instanceof DeleteRefused) return fail(e.message);
    throw e;
  }
  revalidatePositions();
  return { ok: true };
}

export interface AliasResult extends ActionResult {
  /** Students whose positionId moved to the target. */
  moved: number;
  /** Selection rows carried over across all moved students. */
  kept: number;
  /** Selection rows dropped across all moved students. */
  dropped: number;
  /** Moved students whose availability now fails validation. */
  failing: number;
  /** W2W position mappings re-pointed at the target along with the students. */
  remapped: number;
}

/** Paths that read the W2W position map. */
function revalidateW2wSurfaces() {
  revalidatePath("/admin/w2w");
  revalidatePath("/admin/schedule/plan");
}

/**
 * Move every W2W mapping off `fromId` onto `toId`. Several W2W positions may
 * share one Muster position (Dock Stocker rides Stocker), so landing on a
 * target that already has mappings is normal.
 *
 * The moved rows are stacked above the target's highest fill order rather than
 * keeping their own. Fill order decides which of the W2W positions sharing a
 * block a student is written onto, and two rows arriving on the same number
 * would leave that to the order W2W happened to export in. Their order
 * relative to each other is preserved.
 */
async function repointW2wMappings(tx: DbTx, fromId: string, toId: string): Promise<number> {
  const [moving, existing] = await Promise.all([
    tx
      .select({ id: w2wPositionMap.w2wPositionId, fillOrder: w2wPositionMap.fillOrder })
      .from(w2wPositionMap)
      .where(eq(w2wPositionMap.musterPositionId, fromId)),
    tx
      .select({ fillOrder: w2wPositionMap.fillOrder })
      .from(w2wPositionMap)
      .where(eq(w2wPositionMap.musterPositionId, toId)),
  ]);
  if (moving.length === 0) return 0;

  const base = existing.reduce((n, r) => Math.max(n, r.fillOrder + 1), 0);
  const ordered = [...moving].sort((a, b) => a.fillOrder - b.fillOrder || a.id.localeCompare(b.id));
  for (const [at, row] of ordered.entries()) {
    await tx
      .update(w2wPositionMap)
      .set({ musterPositionId: toId, fillOrder: base + at })
      .where(eq(w2wPositionMap.w2wPositionId, row.id));
  }
  return ordered.length;
}

/**
 * Turn `sourceId` into an alias of `targetId`: move every student holding the
 * source position to the target through the shared carry-over routine, then
 * set mergedIntoId, all in one transaction. Returns a summary for the UI.
 */
export async function setAlias(sourceId: string, targetId: string): Promise<AliasResult> {
  const fail = (error: string): AliasResult => ({
    ok: false,
    error,
    moved: 0,
    kept: 0,
    dropped: 0,
    failing: 0,
    remapped: 0,
  });
  const gate = await requireAdmin();
  if (!gate.ok) return fail(gate.error);
  if (sourceId === targetId) return fail("A position can't be an alias of itself.");
  if (sourceId === SHIFT_LEAD_POSITION_ID) {
    return fail("Shift Lead is built in and can't be made an alias.");
  }

  const db = getDb();
  const rows = await db
    .select({ id: positions.id, name: positions.name, mergedIntoId: positions.mergedIntoId })
    .from(positions)
    .where(inArray(positions.id, [sourceId, targetId]));
  const source = rows.find((r) => r.id === sourceId);
  const target = rows.find((r) => r.id === targetId);
  if (!source || !target) return fail("Position not found.");
  if (source.mergedIntoId !== null) {
    return fail("This position is already an alias. Remove that alias first.");
  }
  if (!canAliasTo(target)) {
    const [canonical] = await db
      .select({ name: positions.name })
      .from(positions)
      .where(eq(positions.id, target.mergedIntoId!))
      .limit(1);
    return fail(
      `${target.name} is an alias itself. Pick ${canonical?.name ?? "the position it points to"} instead.`,
    );
  }

  let moved = 0;
  let kept = 0;
  let dropped = 0;
  let failing = 0;
  let remapped = 0;
  await db.transaction(async (tx) => {
    const affected = await tx
      .select({ email: students.email })
      .from(students)
      .where(eq(students.positionId, sourceId));
    // Re-point positionId before the per-student routine so revalidation reads
    // the new position (same order the roster importer uses).
    await tx
      .update(students)
      .set({ positionId: targetId })
      .where(eq(students.positionId, sourceId));
    for (const { email } of affected) {
      const change = await applyPositionChange(tx, {
        email,
        fromPositionId: sourceId,
        toPositionId: targetId,
      });
      kept += change.carriedOver;
      dropped += change.dropped;
      if (change.revalidationFailed) failing += 1;
    }
    moved = affected.length;
    // Follow the students. The source keeps its blocks, so W2W plan rows would
    // go on matching them and still count as matched, while nobody is ever
    // assigned there again: every one of those shifts would quietly export
    // with no name (docs/w2w-shift-plan-roundtrip.md §4).
    remapped = await repointW2wMappings(tx, sourceId, targetId);
    await tx.update(positions).set({ mergedIntoId: targetId }).where(eq(positions.id, sourceId));
  });

  revalidatePositions();
  revalidateStudentSurfaces();
  if (remapped > 0) revalidateW2wSurfaces();
  return { ok: true, moved, kept, dropped, failing, remapped };
}

/**
 * Remove an alias link. Students do not move back; they return when a future
 * roster import maps their title to this position again.
 */
export async function clearAlias(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const db = getDb();
  const [row] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(eq(positions.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "Position not found." };

  await db.update(positions).set({ mergedIntoId: null }).where(eq(positions.id, id));
  revalidatePositions();
  return { ok: true };
}

export async function createBlock(
  positionId: string,
  dayType: DayType,
  startMinutes: number,
  endMinutes: number,
  desiredCapacity: number | null,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (dayType !== "weekday" && dayType !== "weekend") {
    return { ok: false, error: "Invalid day type." };
  }
  const timeError = validateBlockTimes(startMinutes, endMinutes);
  if (timeError) return { ok: false, error: timeError };
  const capacityError = validateDesiredCapacity(desiredCapacity);
  if (capacityError) return { ok: false, error: capacityError };

  const db = getDb();
  const [pos] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(eq(positions.id, positionId))
    .limit(1);
  if (!pos) return { ok: false, error: "Position not found." };

  // Was this position unusable until now? A ghost resolution creates a
  // position before its shifts exist, which defers the carry-over for everyone
  // moved into it; adding the first block is what finally resolves it.
  const [live] = await db
    .select({ n: sql<number>`count(*)` })
    .from(shiftBlocks)
    .where(and(eq(shiftBlocks.positionId, positionId), liveBlocksOnly()));
  const wasBlockless = Number(live?.n ?? 0) === 0;

  // Block ids are opaque handles: the prefix keeps them readable, the random
  // suffix keeps them unique without encoding times that would go stale.
  const id = `${positionId}-${dayType}-${randomUUID().slice(0, 8)}`;
  await db.transaction(async (tx) => {
    await tx
      .insert(shiftBlocks)
      .values({ id, positionId, dayType, startMinutes, endMinutes, desiredCapacity });
    if (wasBlockless) await resolveDeferredCarryOver(tx, positionId);
  });

  revalidateBlockSurfaces();
  return { ok: true };
}

export interface DeleteBlockResult extends ActionResult {
  /** True when picks kept the row alive and the shift was retired instead. */
  retired: boolean;
  /** Students whose picks this removal orphaned. */
  orphaned: number;
}

/**
 * Remove a block. With nothing pointing at it the row is deleted outright.
 * With picks on it (the students' own or an internal copy's, PLAN §10a) the
 * row is RETIRED instead: it stays so those picks keep a time to show, but
 * every live read filters it out, so the shift is gone from the student grid,
 * the rules, coverage, the export, and the generator. Those picks become
 * orphaned and each affected student is flagged for the admin to clear.
 */
export async function deleteBlock(blockId: string): Promise<DeleteBlockResult> {
  const fail = (error: string): DeleteBlockResult => ({
    ok: false,
    error,
    retired: false,
    orphaned: 0,
  });
  const gate = await requireAdmin();
  if (!gate.ok) return fail(gate.error);

  const db = getDb();
  let outcome: { retired: boolean; orphaned: number };
  try {
    outcome = await db.transaction(async (tx) => {
      // Locking read, with everything this decides on read behind it. InnoDB
      // takes a shared lock on the parent row for every child insert's FK
      // check, so while this X lock is held no pick and no schedule assignment
      // can land on the block: the counts below still describe it when the
      // write runs. A plain read, even in here, sees a snapshot and leaves a
      // window for a schedule generation to commit into.
      const [row] = await tx
        .select({ id: shiftBlocks.id, retiredAt: shiftBlocks.retiredAt })
        .from(shiftBlocks)
        .where(eq(shiftBlocks.id, blockId))
        .limit(1)
        .for("update");
      if (!row) throw new DeleteRefused("Block not found.");
      if (row.retiredAt !== null) throw new DeleteRefused("This shift is already removed.");

      // Count the students' own picks, internal-copy cells (PLAN §10a), and rows
      // in any saved schedule run. The first two would break the FK on delete; the
      // third would NOT (schedule_assignments cascades), which is exactly why it
      // has to be counted: a hard delete would quietly erase shifts out of a run
      // the scheduler already worked from.
      const [ref] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(shiftSelections)
        .where(eq(shiftSelections.shiftBlockId, blockId));
      const [internalRef] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(internalSelections)
        .where(eq(internalSelections.shiftBlockId, blockId));
      const [assignedRef] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(scheduleAssignments)
        .where(eq(scheduleAssignments.shiftBlockId, blockId));
      const refCount =
        Number(ref?.n ?? 0) + Number(internalRef?.n ?? 0) + Number(assignedRef?.n ?? 0);

      if (refCount === 0) {
        await tx.delete(shiftBlocks).where(eq(shiftBlocks.id, blockId));
        return { retired: false, orphaned: 0 };
      }

      await tx
        .update(shiftBlocks)
        .set({ retiredAt: new Date() })
        .where(eq(shiftBlocks.id, blockId));
      // Retiring shrinks the live set, so both flags can move: picks on this
      // block are orphaned now, and what remains may no longer validate.
      const orphaned = await syncOrphanFlagsForBlocks(tx, [blockId]);
      await revalidateSubmissionsHolding(tx, [blockId]);
      return { retired: true, orphaned };
    });
  } catch (e) {
    if (e instanceof DeleteRefused) return fail(e.message);
    throw e;
  }

  revalidateBlockSurfaces();
  return { ok: true, ...outcome };
}

/**
 * Put a retired shift back. Picks the retirement orphaned resolve themselves:
 * the block is live again, so it counts again and both flags clear.
 */
export async function restoreBlock(blockId: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const db = getDb();
  const [row] = await db
    .select({ id: shiftBlocks.id, retiredAt: shiftBlocks.retiredAt })
    .from(shiftBlocks)
    .where(eq(shiftBlocks.id, blockId))
    .limit(1);
  if (!row) return { ok: false, error: "Block not found." };
  if (row.retiredAt === null) return { ok: false, error: "This shift is not removed." };

  await db.transaction(async (tx) => {
    await tx.update(shiftBlocks).set({ retiredAt: null }).where(eq(shiftBlocks.id, blockId));
    await syncOrphanFlagsForBlocks(tx, [blockId]);
    await revalidateSubmissionsHolding(tx, [blockId]);
  });

  revalidateBlockSurfaces();
  return { ok: true };
}

export interface GhostResolveResult extends ActionResult {
  /** Students whose null position was set by this resolution. */
  assigned: number;
}

/**
 * Assign `positionId` to every position-less student whose stored roster
 * title matches `rawTitle`, running the shared position-change routine for
 * each. Title matching happens in JS because normalization lives there.
 */
async function assignStudentsForTitle(
  tx: DbTx,
  rawTitle: string,
  positionId: string,
): Promise<number> {
  const normalized = normalizeTitle(rawTitle);
  const rows = await tx
    .select({ email: students.email, rosterTitle: students.rosterTitle })
    .from(students)
    .where(and(isNull(students.positionId), isNotNull(students.rosterTitle)));
  const matched = rows
    .filter((r) => normalizeTitle(r.rosterTitle ?? "") === normalized)
    .map((r) => r.email);
  if (matched.length === 0) return 0;

  // Set positionId first so the per-student revalidation reads the new position.
  await tx.update(students).set({ positionId }).where(inArray(students.email, matched));
  for (const email of matched) {
    await applyPositionChange(tx, { email, fromPositionId: null, toPositionId: positionId });
  }
  return matched.length;
}

function revalidateGhostSurfaces() {
  revalidatePositions();
  revalidatePath("/admin/roster");
  revalidateStudentSurfaces();
}

/**
 * Ghost resolution, option 1: create a new position named after the roster
 * title, map the title to it, and assign the affected students.
 */
export async function createPositionForTitle(rawTitle: string): Promise<GhostResolveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error, assigned: 0 };
  const trimmed = rawTitle.trim();
  if (!trimmed) return { ok: false, error: "No roster title to resolve.", assigned: 0 };
  const name = trimmed.slice(0, POSITION_NAME_MAX);
  const id = slugifyPositionId(trimmed);
  if (!id) {
    return { ok: false, error: "The title needs at least one letter or number.", assigned: 0 };
  }

  const db = getDb();
  const clash = await db
    .select({ id: positions.id })
    .from(positions)
    .where(or(eq(positions.id, id), eq(positions.name, name)))
    .limit(1);
  if (clash.length > 0) {
    return {
      ok: false,
      error: "A position with that name already exists. Map the title to it instead.",
      assigned: 0,
    };
  }

  let assigned = 0;
  await db.transaction(async (tx) => {
    await tx.insert(positions).values({ id, name, ...NEW_POSITION_DEFAULTS });
    // onDuplicateKeyUpdate covers a stale mapping row pointing at a deleted position.
    await tx
      .insert(rosterTitleMappings)
      .values({ title: normalizeTitle(trimmed), positionId: id })
      .onDuplicateKeyUpdate({ set: { positionId: id } });
    assigned = await assignStudentsForTitle(tx, trimmed, id);
  });

  revalidateGhostSurfaces();
  return { ok: true, assigned };
}

/**
 * Ghost resolution, option 2: map the roster title to an existing active,
 * non-alias position and assign the affected students.
 */
export async function mapTitleToPosition(
  rawTitle: string,
  positionId: string,
): Promise<GhostResolveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error, assigned: 0 };
  const trimmed = rawTitle.trim();
  if (!trimmed) return { ok: false, error: "No roster title to resolve.", assigned: 0 };

  const db = getDb();
  const [target] = await db
    .select({
      id: positions.id,
      name: positions.name,
      active: positions.active,
      mergedIntoId: positions.mergedIntoId,
    })
    .from(positions)
    .where(eq(positions.id, positionId))
    .limit(1);
  if (!target) return { ok: false, error: "Position not found.", assigned: 0 };
  if (target.mergedIntoId !== null) {
    return {
      ok: false,
      error: `${target.name} is an alias. Pick the position it points to.`,
      assigned: 0,
    };
  }
  if (!target.active) {
    return { ok: false, error: `${target.name} is inactive. Reactivate it first.`, assigned: 0 };
  }

  let assigned = 0;
  await db.transaction(async (tx) => {
    await tx
      .insert(rosterTitleMappings)
      .values({ title: normalizeTitle(trimmed), positionId })
      .onDuplicateKeyUpdate({ set: { positionId } });
    assigned = await assignStudentsForTitle(tx, trimmed, positionId);
  });

  revalidateGhostSurfaces();
  return { ok: true, assigned };
}
