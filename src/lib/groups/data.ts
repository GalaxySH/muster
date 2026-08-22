/**
 * Server-side reads for student groups + form windows (PLAN.md §13).
 *
 * The access resolver is the heart of the gate: a student with no group is
 * denied; otherwise their group's window decides editability. The picker/list
 * helpers back the admin assignment surface, including a hire-date filter that
 * shares its matcher with the response dashboard (`domain/calendar-day.ts`).
 * Pure window math lives in `domain/window.ts`; this layer only loads + joins.
 */
import "server-only";
import { and, asc, eq, isNotNull, isNull, like, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { groups, students, positions, submissions } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/auth/policy";
import { getSetting, SETTING_DEFAULT_GROUP_AUTO_ASSIGN } from "@/lib/settings";
import {
  windowState,
  canEditSubmission,
  isLockedAfterSubmit,
  type WindowState,
} from "@/lib/domain/window";
import { matchesStarted, type StartedMode } from "@/lib/domain/calendar-day";

export interface GroupRow {
  id: string;
  name: string;
  opensAt: Date | null;
  closesAt: Date | null;
  lockAfterSubmit: boolean;
  isDefault: boolean;
  memberCount: number;
  /** Member emails (sorted); feeds the per-group "copy emails" control. */
  memberEmails: string[];
}

/** All groups (default first, then by name) with their members. */
export async function listGroups(): Promise<GroupRow[]> {
  const db = getDb();
  const rows = await db.select().from(groups).orderBy(asc(groups.name));
  const memberRows = await db
    .select({ groupId: students.groupId, email: students.email })
    .from(students)
    .where(isNotNull(students.groupId))
    .orderBy(asc(students.email));
  const emailsByGroup = new Map<string, string[]>();
  for (const m of memberRows) {
    if (!m.groupId) continue;
    const list = emailsByGroup.get(m.groupId) ?? [];
    list.push(m.email);
    emailsByGroup.set(m.groupId, list);
  }

  return rows
    .map((g) => {
      const memberEmails = emailsByGroup.get(g.id) ?? [];
      return {
        id: g.id,
        name: g.name,
        opensAt: g.opensAt,
        closesAt: g.closesAt,
        lockAfterSubmit: g.lockAfterSubmit,
        isDefault: g.isDefault,
        memberCount: memberEmails.length,
        memberEmails,
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/**
 * The current default group: the one that catches swept/self-added students
 * (`isDefault` flag; exactly one by construction, re-pointable via
 * setDefaultGroup). Null only if the seed never ran.
 */
export async function getDefaultGroup(): Promise<typeof groups.$inferSelect | null> {
  const db = getDb();
  const [g] = await db.select().from(groups).where(eq(groups.isDefault, true)).limit(1);
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
      /** The group's "lock editing after submit" setting (PLAN §13). */
      lockAfterSubmit: boolean;
      /** Whether this student has already finalized their submission. */
      submitted: boolean;
      /** Final editability: open window AND not locked-after-submit. */
      canEdit: boolean;
      /** Editing blocked *specifically* because they've already submitted. */
      lockedAfterSubmit: boolean;
    };

/**
 * The two-gate access decision for a student (PLAN §13): membership first
 * (no group ⇒ denied), then the group's window state at `now`. When the group
 * locks editing after submit, an already-submitted student is read-only even
 * with the window open. New submissions are still allowed (PLAN §13).
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

  const [sub] = await db
    .select({ status: submissions.status })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);
  const submitted = sub?.status === "submitted";

  const state = windowState(grp.opensAt, grp.closesAt, now);
  return {
    access: "windowed",
    state,
    opensAt: grp.opensAt,
    closesAt: grp.closesAt,
    groupName: grp.name,
    lockAfterSubmit: grp.lockAfterSubmit,
    submitted,
    canEdit: canEditSubmission(state, grp.lockAfterSubmit, submitted),
    lockedAfterSubmit: isLockedAfterSubmit(state, grp.lockAfterSubmit, submitted),
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
  /** Restrict by roster hire date (`date` is `yyyy-mm-dd`). Students with no
   *  recorded hire date never match while this is set. */
  hiredOn?: { mode: StartedMode; date: string };
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
      hiredOn: students.hiredOn,
    })
    .from(students)
    .leftJoin(positions, eq(students.positionId, positions.id))
    .leftJoin(groups, eq(students.groupId, groups.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(students.displayName), asc(students.email));

  // The hire-date compare (before/after/on) is the same rule the response
  // dashboard filters by, so it runs in memory through the shared matcher
  // rather than as a second SQL date comparison.
  const filtered = filters.hiredOn
    ? rows.filter((r) => matchesStarted(r.hiredOn, filters.hiredOn!))
    : rows;

  return filtered.map((r) => ({
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
