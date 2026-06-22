/**
 * Server-side reads for student groups + form windows (PLAN.md §13).
 *
 * The access resolver is the heart of the gate: a student with no group is
 * denied; otherwise their group's window decides editability. The picker/list
 * helpers back the admin assignment surface. Pure window math lives in
 * `domain/window.ts`; this layer only loads + joins.
 */
import "server-only";
import { and, asc, eq, isNull, like, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { groups, students, positions } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/auth/policy";
import { getSetting, SETTING_DEFAULT_GROUP_AUTO_ASSIGN } from "@/lib/settings";
import { windowState, type WindowState } from "@/lib/domain/window";
import { DEFAULT_GROUP_ID } from "./constants";

export interface GroupRow {
  id: string;
  name: string;
  opensAt: Date | null;
  closesAt: Date | null;
  isDefault: boolean;
  memberCount: number;
}

/** All groups (default first, then by name) with their member counts. */
export async function listGroups(): Promise<GroupRow[]> {
  const db = getDb();
  const rows = await db.select().from(groups).orderBy(asc(groups.name));
  const countRows = await db
    .select({ groupId: students.groupId, n: sql<number>`count(*)` })
    .from(students)
    .groupBy(students.groupId);
  const countByGroup = new Map<string, number>();
  for (const c of countRows) if (c.groupId) countByGroup.set(c.groupId, Number(c.n));

  return rows
    .map((g) => ({
      id: g.id,
      name: g.name,
      opensAt: g.opensAt,
      closesAt: g.closesAt,
      isDefault: g.isDefault,
      memberCount: countByGroup.get(g.id) ?? 0,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** The non-deletable default ("New Student") group, or null if not seeded. */
export async function getDefaultGroup(): Promise<typeof groups.$inferSelect | null> {
  const db = getDb();
  const [g] = await db.select().from(groups).where(eq(groups.id, DEFAULT_GROUP_ID)).limit(1);
  return g ?? null;
}

/** Whether ungrouped students are swept into the default group (PLAN §13). */
export async function getDefaultAutoAssignEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_DEFAULT_GROUP_AUTO_ASSIGN)) === "1";
}

export type StudentAccess =
  | { access: "no-group" }
  | {
      access: "windowed";
      state: WindowState;
      opensAt: Date | null;
      closesAt: Date | null;
      groupName: string;
    };

/**
 * The two-gate access decision for a student (PLAN §13): membership first
 * (no group ⇒ denied), then the group's window state at `now`.
 */
export async function resolveStudentAccess(
  emailRaw: string,
  now: Date = new Date(),
): Promise<StudentAccess> {
  const db = getDb();
  const email = normalizeEmail(emailRaw);
  const [stu] = await db
    .select({ groupId: students.groupId })
    .from(students)
    .where(eq(students.email, email))
    .limit(1);
  if (!stu || !stu.groupId) return { access: "no-group" };

  const [grp] = await db.select().from(groups).where(eq(groups.id, stu.groupId)).limit(1);
  if (!grp) return { access: "no-group" };

  return {
    access: "windowed",
    state: windowState(grp.opensAt, grp.closesAt, now),
    opensAt: grp.opensAt,
    closesAt: grp.closesAt,
    groupName: grp.name,
  };
}

export interface PickerFilters {
  /** A position id, or "none" for students with no position. */
  positionId?: string | "none";
  onRoster?: boolean;
  /** A group id, or "none" for ungrouped students. */
  groupId?: string | "none";
  /** Case-insensitive substring on display name or email. */
  search?: string;
}

export interface PickerStudent {
  email: string;
  displayName: string;
  positionId: string | null;
  positionName: string | null;
  onRoster: boolean;
  groupId: string | null;
  groupName: string | null;
  groupAssignedAuto: boolean;
}

/** Students matching the picker filters, ordered by name (PLAN §13). */
export async function listStudentsForPicker(filters: PickerFilters = {}): Promise<PickerStudent[]> {
  const db = getDb();
  const conds = [];
  if (filters.onRoster !== undefined) conds.push(eq(students.onRoster, filters.onRoster));
  if (filters.positionId === "none") conds.push(isNull(students.positionId));
  else if (filters.positionId) conds.push(eq(students.positionId, filters.positionId));
  if (filters.groupId === "none") conds.push(isNull(students.groupId));
  else if (filters.groupId) conds.push(eq(students.groupId, filters.groupId));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conds.push(or(like(students.displayName, q), like(students.email, q)));
  }

  const rows = await db
    .select({
      email: students.email,
      displayName: students.displayName,
      positionId: students.positionId,
      positionName: positions.name,
      onRoster: students.onRoster,
      groupId: students.groupId,
      groupName: groups.name,
      groupAssignedAuto: students.groupAssignedAuto,
    })
    .from(students)
    .leftJoin(positions, eq(students.positionId, positions.id))
    .leftJoin(groups, eq(students.groupId, groups.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(students.displayName), asc(students.email));

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionId: r.positionId,
    positionName: r.positionName ?? null,
    onRoster: r.onRoster,
    groupId: r.groupId,
    groupName: r.groupName ?? null,
    groupAssignedAuto: r.groupAssignedAuto,
  }));
}
