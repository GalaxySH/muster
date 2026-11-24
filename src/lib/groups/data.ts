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
import { groups, students, positions, submissions, termMembers } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/auth/policy";
import { getSetting, SETTING_DEFAULT_GROUP_AUTO_ASSIGN } from "@/lib/settings";
import {
  windowState,
  canEditSubmission,
  isLockedAfterSubmit,
  type WindowState,
} from "@/lib/domain/window";
import { matchesStarted, type StartedMode } from "@/lib/domain/calendar-day";
import { currentTermId } from "@/lib/terms/current";
import { submissionOf, memberOf } from "@/lib/terms/scope";
import { groupOf, inGroup, inNoGroup } from "@/lib/groups/membership";

export interface GroupRow {
  id: string;
  name: string;
  opensAt: Date | null;
  closesAt: Date | null;
  lockAfterSubmit: boolean;
  isDefault: boolean;
  /** The term's test-accounts group, which is managed on /admin/test-users. */
  isTest: boolean;
  memberCount: number;
  /** Member emails (sorted); feeds the per-group "copy emails" control. */
  memberEmails: string[];
}

/** The term's groups (default first, then by name) with their members. */
export async function listGroups(): Promise<GroupRow[]> {
  const db = getDb();
  const termId = await currentTermId();
  const rows = await db
    .select()
    .from(groups)
    .where(eq(groups.termId, termId))
    .orderBy(asc(groups.name));
  const memberRows = await db
    .select({ groupId: termMembers.groupId, email: termMembers.studentEmail })
    .from(termMembers)
    .where(and(eq(termMembers.termId, termId), isNotNull(termMembers.groupId)))
    .orderBy(asc(termMembers.studentEmail));
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
        isTest: g.kind === "test",
        memberCount: memberEmails.length,
        memberEmails,
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/**
 * The term's default group: the one that catches swept/self-added students
 * (`isDefault` flag; exactly one per term by construction, re-pointable via
 * setDefaultGroup). Null only if the term was never given one.
 */
export async function getDefaultGroup(): Promise<typeof groups.$inferSelect | null> {
  const db = getDb();
  const [g] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.isDefault, true), eq(groups.termId, await currentTermId())))
    .limit(1);
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
  const termId = await currentTermId();
  const grp = await groupOf(db, email, termId);
  if (!grp) return { access: "no-group" };

  const [sub] = await db
    .select({ status: submissions.status })
    .from(submissions)
    .where(submissionOf(email, termId))
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
  if (filters.onRoster !== undefined) conds.push(eq(termMembers.onRoster, filters.onRoster));
  if (filters.positionId === "none") conds.push(isNull(termMembers.positionId));
  else if (filters.positionId) conds.push(eq(termMembers.positionId, filters.positionId));
  const termId = await currentTermId();
  if (filters.groupId === "none") conds.push(inNoGroup(termId));
  else if (filters.groupId) conds.push(inGroup(filters.groupId));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conds.push(or(like(students.displayName, q), like(students.email, q)));
  }

  const rows = await db
    .select({
      email: students.email,
      displayName: students.displayName,
      positionId: termMembers.positionId,
      positionName: positions.name,
      onRoster: termMembers.onRoster,
      groupId: termMembers.groupId,
      groupName: groups.name,
      groupAssignedAuto: termMembers.assignedAuto,
      hiredOn: students.hiredOn,
    })
    .from(students)
    // Inner: only people who belong to this term can be put in its groups.
    .innerJoin(termMembers, memberOf(termId))
    .leftJoin(positions, eq(termMembers.positionId, positions.id))
    .leftJoin(groups, eq(termMembers.groupId, groups.id))
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
    groupId: r.groupId ?? null,
    groupName: r.groupName ?? null,
    groupAssignedAuto: r.groupAssignedAuto ?? false,
  }));
}
