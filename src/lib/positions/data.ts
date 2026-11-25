/**
 * Server-side reads for the positions config (roadmap 3.3).
 *
 * The DB is the source of truth once admins can edit positions, so every
 * consumer reads through here instead of the static fixture in
 * `config/positions.ts` (which only seeds an empty table). Inactive and
 * aliased positions stay resolvable by id for historical data, but are
 * hidden from pickers and from new assignment.
 */
import "server-only";
import { and, asc, eq, isNotNull, isNull, not, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  internalSelections,
  positions,
  rosterTitleMappings,
  shiftBlocks,
  shiftSelections,
  students,
  submissions,
  w2wPositionMap,
  termMembers,
} from "@/lib/db/schema";
import { toDomainPosition } from "@/lib/db/mappers";
import type { DayType, Position } from "@/lib/domain/types";
import { workingTermId } from "@/lib/terms/working";
import { submissionOfStudent, rosterOf } from "@/lib/terms/scope";
import { inTestGroup } from "@/lib/groups/membership";

export interface PositionListItem {
  position: Position;
  active: boolean;
  /** Set when this position is an alias of another; no data points at it. */
  mergedIntoId: string | null;
}

/**
 * The term's positions ordered by name. Default: active, non-alias only (what the app
 * treats as assignable); `includeInactive` returns every row.
 */
export async function listPositions(
  termId: string,
  opts?: { includeInactive?: boolean },
): Promise<PositionListItem[]> {
  const rows = await getDb()
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.termId, termId),
        opts?.includeInactive
          ? undefined
          : and(eq(positions.active, true), isNull(positions.mergedIntoId)),
      ),
    )
    .orderBy(asc(positions.name));
  return rows.map((row) => ({
    position: toDomainPosition(row),
    active: row.active,
    mergedIntoId: row.mergedIntoId,
  }));
}

/** Picker options (active, non-alias), ordered by name. */
export async function positionOptions(termId: string): Promise<{ id: string; name: string }[]> {
  const items = await listPositions(termId);
  return items.map(({ position }) => ({ id: position.id, name: position.name }));
}

/**
 * A position's admin-configured return-to-work date ("YYYY-MM-DD", shown on
 * /travel), or null when unset. Null positionId (no position assigned) also
 * reads null.
 */
export async function getPositionReturnDate(positionId: string | null): Promise<string | null> {
  if (!positionId) return null;
  const [row] = await getDb()
    .select({ returnDate: positions.returnDate })
    .from(positions)
    .where(eq(positions.id, positionId))
    .limit(1);
  return row?.returnDate ?? null;
}

/** One block on the admin surface, with its live selection reference count. */
export interface AdminBlockItem {
  id: string;
  positionId: string;
  dayType: DayType;
  start: number;
  end: number;
  /** Target staffing per day, or null for no target (roadmap 5.1). */
  desiredCapacity: number | null;
  /** shift_selections rows referencing this block (delete/edit guards). */
  selectionCount: number;
  /** Same, but excluding test accounts: the real student picks shown to the admin. */
  realPickCount: number;
  /**
   * True once an admin removed a shift students had already picked: the row
   * lives on only so those picks keep a time to show, and nothing else reads
   * it (PLAN §6.2a). The config page is the one place retired blocks appear,
   * so the admin can put one back.
   */
  retired: boolean;
}

/** One position on /admin/positions: every row, plus blocks and reference counts. */
export interface AdminPositionItem {
  id: string;
  name: string;
  minHours: number;
  minDays: number;
  weekendExempt: boolean;
  active: boolean;
  mergedIntoId: string | null;
  /** Resolved name of the alias target, when mergedIntoId is set. */
  mergedIntoName: string | null;
  /** Return-to-work date ("YYYY-MM-DD") shown on /travel; null hides that card entirely. */
  returnDate: string | null;
  /** Holders pick weekend closes. Built in: it can't be deleted or aliased. */
  picksCloses: boolean;
  /** People holding the position, on- and off-roster (delete guard). */
  studentCount: number;
  /** On-roster students holding this position (the capacity check's demand side). */
  onRosterCount: number;
  /**
   * W2W positions mapped onto this one (roadmap 5.3). Deleting the position
   * takes them with it, and they are seeded config a plan import needs, so the
   * delete confirm names them first.
   */
  w2wMappingCount: number;
  /**
   * Roster titles that map here, normalized and sorted. The position card
   * edits this list, so an admin can re-point a title without deleting the
   * position it was mapped to (1.29).
   */
  rosterTitles: string[];
  blocks: AdminBlockItem[];
}

/**
 * Everything /admin/positions renders: every position (including inactive and
 * aliases) with its blocks (both day-types, by start time) and reference
 * counts, ordered by name.
 */
export async function listPositionsAdmin(): Promise<AdminPositionItem[]> {
  const db = getDb();
  const termId = await workingTermId();
  const [
    posRows,
    blockRows,
    studentRows,
    onRosterRows,
    selectionRows,
    internalSelectionRows,
    realPickRows,
    w2wMapRows,
    titleRows,
  ] = await Promise.all([
    db.select().from(positions).where(eq(positions.termId, termId)).orderBy(asc(positions.name)),
    db
      .select()
      .from(shiftBlocks)
      .where(eq(shiftBlocks.termId, termId))
      .orderBy(asc(shiftBlocks.startMinutes), asc(shiftBlocks.endMinutes)),
    db
      .select({ positionId: termMembers.positionId, n: sql<number>`count(*)` })
      .from(termMembers)
      .where(eq(termMembers.termId, termId))
      .groupBy(termMembers.positionId),
    db
      .select({ positionId: termMembers.positionId, n: sql<number>`count(*)` })
      .from(termMembers)
      .where(and(rosterOf(termId), isNotNull(termMembers.positionId)))
      .groupBy(termMembers.positionId),
    // All selections, for the FK delete/edit guards (a test account's pick still
    // pins the block in the DB, so the guard must count it). The admin's
    // internal copies count the same way, so the removal warning matches what
    // `deleteBlock` actually decides.
    db
      .select({ blockId: shiftSelections.shiftBlockId, n: sql<number>`count(*)` })
      .from(shiftSelections)
      .groupBy(shiftSelections.shiftBlockId),
    db
      .select({ blockId: internalSelections.shiftBlockId, n: sql<number>`count(*)` })
      .from(internalSelections)
      .groupBy(internalSelections.shiftBlockId),
    // Real student picks only, for the count the admin reads: join to the owning
    // student and drop the test-accounts group (the same convention the response
    // surfaces use to hide throwaway accounts).
    db
      .select({ blockId: shiftSelections.shiftBlockId, n: sql<number>`count(*)` })
      .from(shiftSelections)
      .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
      .innerJoin(students, submissionOfStudent(termId))
      .where(not(inTestGroup(termId)))
      .groupBy(shiftSelections.shiftBlockId),
    // W2W positions pointing here, for the delete confirm (roadmap 5.3).
    db
      .select({ positionId: w2wPositionMap.musterPositionId, n: sql<number>`count(*)` })
      .from(w2wPositionMap)
      .where(eq(w2wPositionMap.termId, termId))
      .groupBy(w2wPositionMap.musterPositionId),
    db.select().from(rosterTitleMappings).where(eq(rosterTitleMappings.termId, termId)),
  ]);

  const nameById = new Map(posRows.map((p) => [p.id, p.name]));
  const studentCount = new Map(studentRows.map((r) => [r.positionId, Number(r.n)]));
  const onRosterCount = new Map(onRosterRows.map((r) => [r.positionId, Number(r.n)]));
  const w2wMappingCount = new Map(w2wMapRows.map((r) => [r.positionId, Number(r.n)]));
  const rosterTitles = new Map<string, string[]>();
  for (const t of titleRows) {
    rosterTitles.set(t.positionId, [...(rosterTitles.get(t.positionId) ?? []), t.title].sort());
  }
  const selectionCount = new Map(selectionRows.map((r) => [r.blockId, Number(r.n)]));
  for (const r of internalSelectionRows) {
    selectionCount.set(r.blockId, (selectionCount.get(r.blockId) ?? 0) + Number(r.n));
  }
  const realPickCount = new Map(realPickRows.map((r) => [r.blockId, Number(r.n)]));
  const blocksByPosition = new Map<string, AdminBlockItem[]>();
  for (const b of blockRows) {
    const list = blocksByPosition.get(b.positionId) ?? [];
    list.push({
      id: b.id,
      positionId: b.positionId,
      dayType: b.dayType,
      start: b.startMinutes,
      end: b.endMinutes,
      desiredCapacity: b.desiredCapacity,
      selectionCount: selectionCount.get(b.id) ?? 0,
      realPickCount: realPickCount.get(b.id) ?? 0,
      retired: b.retiredAt !== null,
    });
    blocksByPosition.set(b.positionId, list);
  }

  return posRows.map((p) => ({
    id: p.id,
    name: p.name,
    minHours: p.minHours,
    minDays: p.minDays,
    weekendExempt: p.weekendExempt,
    active: p.active,
    mergedIntoId: p.mergedIntoId,
    mergedIntoName: p.mergedIntoId ? (nameById.get(p.mergedIntoId) ?? p.mergedIntoId) : null,
    returnDate: p.returnDate,
    picksCloses: p.picksCloses,
    studentCount: studentCount.get(p.id) ?? 0,
    onRosterCount: onRosterCount.get(p.id) ?? 0,
    w2wMappingCount: w2wMappingCount.get(p.id) ?? 0,
    rosterTitles: rosterTitles.get(p.id) ?? [],
    blocks: blocksByPosition.get(p.id) ?? [],
  }));
}

/** A roster title with no position: on-roster students stuck without a form. */
export interface GhostTitle {
  /** Null when an older import predates roster_title. */
  title: string | null;
  count: number;
}

/**
 * Ghost titles: on-roster students with no position, grouped by their stored
 * roster title, largest group first. Shared by /admin/positions (resolution
 * cards) and /admin/roster (the drift warning).
 */
export async function listGhostTitles(): Promise<GhostTitle[]> {
  const rows = await getDb()
    .select({ title: termMembers.rosterTitle, n: sql<number>`count(*)` })
    .from(termMembers)
    .where(and(rosterOf(await workingTermId()), isNull(termMembers.positionId)))
    .groupBy(termMembers.rosterTitle);
  return rows
    .map((r) => ({ title: r.title, count: Number(r.n) }))
    .sort((a, b) => b.count - a.count);
}
