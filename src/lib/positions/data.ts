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
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, shiftBlocks, shiftSelections, students } from "@/lib/db/schema";
import { toDomainPosition } from "@/lib/db/mappers";
import type { DayType, Position } from "@/lib/domain/types";

export interface PositionListItem {
  position: Position;
  active: boolean;
  /** Set when this position is an alias of another; no data points at it. */
  mergedIntoId: string | null;
}

/**
 * Positions ordered by name. Default: active, non-alias only (what the app
 * treats as assignable); `includeInactive` returns every row.
 */
export async function listPositions(opts?: {
  includeInactive?: boolean;
}): Promise<PositionListItem[]> {
  const rows = await getDb()
    .select()
    .from(positions)
    .where(
      opts?.includeInactive
        ? undefined
        : and(eq(positions.active, true), isNull(positions.mergedIntoId)),
    )
    .orderBy(asc(positions.name));
  return rows.map((row) => ({
    position: toDomainPosition(row),
    active: row.active,
    mergedIntoId: row.mergedIntoId,
  }));
}

/** Picker options (active, non-alias), ordered by name. */
export async function positionOptions(): Promise<{ id: string; name: string }[]> {
  const items = await listPositions();
  return items.map(({ position }) => ({ id: position.id, name: position.name }));
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
  /** students.positionId references, on- and off-roster (delete guard). */
  studentCount: number;
  /** On-roster students holding this position (the capacity check's demand side). */
  onRosterCount: number;
  blocks: AdminBlockItem[];
}

/**
 * Everything /admin/positions renders: every position (including inactive and
 * aliases) with its blocks (both day-types, by start time) and reference
 * counts, ordered by name.
 */
export async function listPositionsAdmin(): Promise<AdminPositionItem[]> {
  const db = getDb();
  const [posRows, blockRows, studentRows, onRosterRows, selectionRows] = await Promise.all([
    db.select().from(positions).orderBy(asc(positions.name)),
    db
      .select()
      .from(shiftBlocks)
      .orderBy(asc(shiftBlocks.startMinutes), asc(shiftBlocks.endMinutes)),
    db
      .select({ positionId: students.positionId, n: sql<number>`count(*)` })
      .from(students)
      .groupBy(students.positionId),
    db
      .select({ positionId: students.positionId, n: sql<number>`count(*)` })
      .from(students)
      .where(and(eq(students.onRoster, true), isNotNull(students.positionId)))
      .groupBy(students.positionId),
    db
      .select({ blockId: shiftSelections.shiftBlockId, n: sql<number>`count(*)` })
      .from(shiftSelections)
      .groupBy(shiftSelections.shiftBlockId),
  ]);

  const nameById = new Map(posRows.map((p) => [p.id, p.name]));
  const studentCount = new Map(studentRows.map((r) => [r.positionId, Number(r.n)]));
  const onRosterCount = new Map(onRosterRows.map((r) => [r.positionId, Number(r.n)]));
  const selectionCount = new Map(selectionRows.map((r) => [r.blockId, Number(r.n)]));
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
    studentCount: studentCount.get(p.id) ?? 0,
    onRosterCount: onRosterCount.get(p.id) ?? 0,
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
    .select({ title: students.rosterTitle, n: sql<number>`count(*)` })
    .from(students)
    .where(and(eq(students.onRoster, true), isNull(students.positionId)))
    .groupBy(students.rosterTitle);
  return rows
    .map((r) => ({ title: r.title, count: Number(r.n) }))
    .sort((a, b) => b.count - a.count);
}
