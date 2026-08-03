"use server";

/**
 * Admin-only mutations for the positions/blocks config (roadmap 3.3). All
 * admin-gated. Lifecycle guards live here: Shift Lead is protected (the §18a
 * close-claims gating string-compares its id), referenced positions/blocks
 * refuse deletion, and alias switches + ghost resolutions run the shared
 * position-change routine (selection carry-over, position_change flag,
 * revalidation) per moved student inside one transaction.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  positions,
  internalSelections,
  rosterTitleMappings,
  shiftBlocks,
  shiftSelections,
  students,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { validateBlockTimes, validateDesiredCapacity } from "@/lib/domain/config-validation";
import { canAliasTo } from "@/lib/domain/position-alias";
import type { DayType } from "@/lib/domain/types";
import { normalizeTitle } from "@/lib/roster/position-mapping";
import { applyPositionChange, type DbTx } from "./apply-change";
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

  let details: PositionUpdate | undefined;
  if (changes.details) {
    const checked = checkName(changes.details.name);
    if (!checked.ok) return checked;
    if (!Number.isInteger(changes.details.minHours) || changes.details.minHours < 0) {
      return { ok: false, error: "Minimum hours must be a whole number, 0 or more." };
    }
    if (!Number.isInteger(changes.details.minDays) || changes.details.minDays < 0) {
      return { ok: false, error: "Minimum days must be a whole number, 0 or more." };
    }
    details = { ...changes.details, name: checked.name };
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
  if (blockIds.length > 0) {
    const found = await db
      .select({ id: shiftBlocks.id })
      .from(shiftBlocks)
      .where(and(eq(shiftBlocks.positionId, id), inArray(shiftBlocks.id, blockIds)));
    if (found.length !== new Set(blockIds).size) return { ok: false, error: "Block not found." };
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
  });

  revalidatePositions();
  revalidatePath("/availability");
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

export async function deletePosition(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (id === SHIFT_LEAD_POSITION_ID) {
    return { ok: false, error: "Shift Lead is built in and can't be deleted." };
  }

  const db = getDb();
  const [row] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(eq(positions.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "Position not found." };

  const [studentRef] = await db
    .select({ n: sql<number>`count(*)` })
    .from(students)
    .where(eq(students.positionId, id));
  const studentCount = Number(studentRef?.n ?? 0);
  if (studentCount > 0) {
    return {
      ok: false,
      error: `${studentCount} student${studentCount === 1 ? " still holds" : "s still hold"} this position. Deactivate it instead.`,
    };
  }

  // Both cell tables hold FKs to this position's blocks: the student's own
  // picks and the admin's internal copies (PLAN §10a).
  const [selectionRef] = await db
    .select({ n: sql<number>`count(*)` })
    .from(shiftSelections)
    .innerJoin(shiftBlocks, eq(shiftSelections.shiftBlockId, shiftBlocks.id))
    .where(eq(shiftBlocks.positionId, id));
  const [internalRef] = await db
    .select({ n: sql<number>`count(*)` })
    .from(internalSelections)
    .innerJoin(shiftBlocks, eq(internalSelections.shiftBlockId, shiftBlocks.id))
    .where(eq(shiftBlocks.positionId, id));
  if (Number(selectionRef?.n ?? 0) + Number(internalRef?.n ?? 0) > 0) {
    return {
      ok: false,
      error: "Students still have shift picks on this position's blocks. Deactivate it instead.",
    };
  }

  await db.transaction(async (tx) => {
    await tx.delete(rosterTitleMappings).where(eq(rosterTitleMappings.positionId, id));
    await tx.delete(shiftBlocks).where(eq(shiftBlocks.positionId, id));
    await tx.delete(positions).where(eq(positions.id, id));
  });
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
    await tx.update(positions).set({ mergedIntoId: targetId }).where(eq(positions.id, sourceId));
  });

  revalidatePositions();
  revalidateStudentSurfaces();
  return { ok: true, moved, kept, dropped, failing };
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

  // Block ids are opaque handles: the prefix keeps them readable, the random
  // suffix keeps them unique without encoding times that would go stale.
  const id = `${positionId}-${dayType}-${randomUUID().slice(0, 8)}`;
  await db
    .insert(shiftBlocks)
    .values({ id, positionId, dayType, startMinutes, endMinutes, desiredCapacity });
  revalidatePositions();
  revalidatePath("/availability");
  return { ok: true };
}

export async function deleteBlock(blockId: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const db = getDb();
  const [row] = await db
    .select({ id: shiftBlocks.id })
    .from(shiftBlocks)
    .where(eq(shiftBlocks.id, blockId))
    .limit(1);
  if (!row) return { ok: false, error: "Block not found." };

  // Count both the students' own picks and internal-copy cells (PLAN §10a);
  // either would break the FK on delete.
  const [ref] = await db
    .select({ n: sql<number>`count(*)` })
    .from(shiftSelections)
    .where(eq(shiftSelections.shiftBlockId, blockId));
  const [internalRef] = await db
    .select({ n: sql<number>`count(*)` })
    .from(internalSelections)
    .where(eq(internalSelections.shiftBlockId, blockId));
  const refCount = Number(ref?.n ?? 0) + Number(internalRef?.n ?? 0);
  if (refCount > 0) {
    return {
      ok: false,
      error: `${refCount} student pick${refCount === 1 ? "" : "s"} reference this block, so it can't be removed.`,
    };
  }

  await db.delete(shiftBlocks).where(eq(shiftBlocks.id, blockId));
  revalidatePositions();
  revalidatePath("/availability");
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
