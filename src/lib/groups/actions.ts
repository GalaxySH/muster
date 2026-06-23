"use server";

/**
 * Admin-only group + form-window mutations (PLAN.md §13). All admin-gated.
 *
 * Assignment is persisted to `students.groupId` — manual assignments
 * (picker / pasted emails) clear the sticky `groupAssignedAuto` marker; the
 * default-assignment sweep sets it. The sweep is the batch "Save" action: it
 * only runs when the toggle is on and only touches genuinely-ungrouped,
 * never-auto-assigned students, so an admin's manual choices are never undone.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { groups, students } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/policy";
import { setSetting, SETTING_DEFAULT_GROUP_AUTO_ASSIGN } from "@/lib/settings";
import {
  getDefaultAutoAssignEnabled,
  listStudentsForPicker,
  type PickerFilters,
  type PickerStudent,
} from "./data";
import { parseEmailList } from "./parse-emails";
import { DEFAULT_GROUP_ID } from "./constants";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  if (!session.isAdmin) return { ok: false, error: "Admins only." };
  return { ok: true };
}

function revalidateGroups() {
  revalidatePath("/admin/groups");
}

/**
 * Parse a window bound into a Date, or null. The client converts its local
 * `datetime-local` input into an ISO instant before sending, so the stored value
 * is timezone-unambiguous regardless of where the server runs.
 */
function parseInstant(value: string | null): Date | null {
  const v = value?.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Admin-gated student search backing the assignment picker (PLAN §13). */
export async function searchStudentsForPicker(filters: PickerFilters): Promise<PickerStudent[]> {
  const gate = await requireAdmin();
  if (!gate.ok) return [];
  return listStudentsForPicker(filters);
}

export async function createGroup(name: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a group name." };

  const db = getDb();
  try {
    await db.insert(groups).values({ id: randomUUID(), name: trimmed, isDefault: false });
  } catch {
    return { ok: false, error: "A group with that name already exists." };
  }
  revalidateGroups();
  return { ok: true };
}

export async function renameGroup(id: string, name: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a group name." };

  const db = getDb();
  try {
    await db.update(groups).set({ name: trimmed }).where(eq(groups.id, id));
  } catch {
    return { ok: false, error: "A group with that name already exists." };
  }
  revalidateGroups();
  return { ok: true };
}

export async function setGroupWindow(
  id: string,
  opensAtRaw: string | null,
  closesAtRaw: string | null,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const opensAt = parseInstant(opensAtRaw);
  const closesAt = parseInstant(closesAtRaw);
  // A window needs both bounds (windowState locks on either-null). Both empty is
  // a deliberate clear; exactly one is a half-configured window — reject it so a
  // partial save can't silently persist an unconfigured (locked) window.
  if ((opensAt === null) !== (closesAt === null)) {
    return { ok: false, error: "Set both an open and a close date, or clear both." };
  }
  if (opensAt && closesAt && closesAt.getTime() <= opensAt.getTime()) {
    return { ok: false, error: "The close time must be after the open time." };
  }

  const db = getDb();
  await db.update(groups).set({ opensAt, closesAt }).where(eq(groups.id, id));
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true };
}

/**
 * Toggle a group's "lock editing after submit" setting (PLAN §13). When on, the
 * group still accepts new submissions while its window is open, but a student who
 * has finalized can no longer edit.
 */
export async function setGroupLockAfterSubmit(
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const db = getDb();
  await db.update(groups).set({ lockAfterSubmit: enabled }).where(eq(groups.id, id));
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true };
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (id === DEFAULT_GROUP_ID) return { ok: false, error: "The default group can't be deleted." };

  const db = getDb();
  const [g] = await db.select({ isDefault: groups.isDefault }).from(groups).where(eq(groups.id, id)).limit(1);
  if (!g) return { ok: false, error: "Group not found." };
  if (g.isDefault) return { ok: false, error: "The default group can't be deleted." };

  // Members' group_id is set null by the FK (onDelete: set null) → they revert
  // to ungrouped (denied) until reassigned or swept.
  await db.delete(groups).where(eq(groups.id, id));
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true };
}

/** Manually assign students to a group (clears the sticky auto marker). */
export async function assignStudents(emails: string[], groupId: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (normalized.length === 0) return { ok: false, error: "Select at least one student." };

  const db = getDb();
  const [g] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!g) return { ok: false, error: "Group not found." };

  await db
    .update(students)
    .set({ groupId, groupAssignedAuto: false })
    .where(inArray(students.email, normalized));
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true };
}

export interface PasteAssignResult extends ActionResult {
  assigned: number;
  /** Valid @wisc.edu emails with no matching student row. */
  unmatched: string[];
  /** Tokens that weren't valid @wisc.edu addresses. */
  invalid: string[];
}

/** Assign by a pasted, delimited email list (PLAN §13). */
export async function assignByPaste(blob: string, groupId: string): Promise<PasteAssignResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error, assigned: 0, unmatched: [], invalid: [] };

  const { valid, invalid } = parseEmailList(blob);
  if (valid.length === 0 && invalid.length === 0) {
    return { ok: false, error: "Paste at least one email.", assigned: 0, unmatched: [], invalid: [] };
  }

  const db = getDb();
  const [g] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!g) return { ok: false, error: "Group not found.", assigned: 0, unmatched: [], invalid };

  const matched = valid.length
    ? await db
        .select({ email: students.email })
        .from(students)
        .where(inArray(students.email, valid))
    : [];
  const matchedSet = new Set(matched.map((m) => m.email));
  const matchedEmails = [...matchedSet];
  const unmatched = valid.filter((e) => !matchedSet.has(e));

  if (matchedEmails.length > 0) {
    await db
      .update(students)
      .set({ groupId, groupAssignedAuto: false })
      .where(inArray(students.email, matchedEmails));
  }
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true, assigned: matchedEmails.length, unmatched, invalid };
}

/** Remove students from any group (sets group_id null; keeps the sticky marker). */
export async function unassignStudents(emails: string[]): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (normalized.length === 0) return { ok: false, error: "Select at least one student." };

  const db = getDb();
  await db.update(students).set({ groupId: null }).where(inArray(students.email, normalized));
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true };
}

/** Persist the default-assignment toggle (PLAN §13). */
export async function setDefaultAutoAssign(enabled: boolean): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  await setSetting(SETTING_DEFAULT_GROUP_AUTO_ASSIGN, enabled ? "1" : "0");
  revalidateGroups();
  return { ok: true };
}

export interface SweepResult extends ActionResult {
  enabled: boolean;
  swept: number;
}

/**
 * The batch "Save" action (PLAN §13): if the toggle is on, assign the default
 * group to every ungrouped, never-auto-assigned student and mark them auto
 * (sticky). A no-op when the toggle is off. Idempotent — already-grouped and
 * already-auto students are skipped.
 */
export async function runDefaultAssignmentSweep(): Promise<SweepResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error, enabled: false, swept: 0 };

  const enabled = await getDefaultAutoAssignEnabled();
  if (!enabled) return { ok: true, enabled: false, swept: 0 };

  const db = getDb();
  const targets = await db
    .select({ email: students.email })
    .from(students)
    .where(and(isNull(students.groupId), eq(students.groupAssignedAuto, false)));
  if (targets.length > 0) {
    await db
      .update(students)
      .set({ groupId: DEFAULT_GROUP_ID, groupAssignedAuto: true })
      .where(
        and(isNull(students.groupId), eq(students.groupAssignedAuto, false)),
      );
  }
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true, enabled: true, swept: targets.length };
}
