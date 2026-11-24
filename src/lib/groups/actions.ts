"use server";

/**
 * Admin-only group + form-window mutations (PLAN.md §13). All admin-gated.
 *
 * Assignment is persisted per term through `./membership`. Manual assignments
 * (picker / pasted emails) clear the sticky auto-assigned marker; the
 * default-assignment sweep sets it. The sweep is the batch "Save" action: it
 * only runs when the toggle is on and only touches genuinely-ungrouped,
 * never-auto-assigned students, so an admin's manual choices are never undone.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { groups, students } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import { setSetting, SETTING_DEFAULT_GROUP_AUTO_ASSIGN } from "@/lib/settings";
import {
  getDefaultAutoAssignEnabled,
  getDefaultGroup,
  listStudentsForPicker,
  type PickerFilters,
  type PickerStudent,
} from "./data";
import { parseEmailList } from "./parse-emails";
import { workingTermId } from "@/lib/terms/working";
import { assignMembers, listUnsweptEmails, unassignMembers } from "./membership";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function revalidateGroups() {
  revalidatePath("/admin/groups");
}

/**
 * WHERE for a group id sent by the client: it only matches a group of the
 * working term, so no action here can change another semester's group.
 */
async function thisTermsGroup(id: string) {
  return and(eq(groups.id, id), eq(groups.termId, await workingTermId()));
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
    await db
      .insert(groups)
      .values({ id: randomUUID(), termId: await workingTermId(), name: trimmed, isDefault: false });
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
    await db.update(groups).set({ name: trimmed }).where(await thisTermsGroup(id));
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
  // a deliberate clear; exactly one is a half-configured window; reject it so a
  // partial save can't silently persist an unconfigured (locked) window.
  if ((opensAt === null) !== (closesAt === null)) {
    return { ok: false, error: "Set both an open and a close date, or clear both." };
  }
  if (opensAt && closesAt && closesAt.getTime() <= opensAt.getTime()) {
    return { ok: false, error: "The close time must be after the open time." };
  }

  const db = getDb();
  await db.update(groups).set({ opensAt, closesAt }).where(await thisTermsGroup(id));
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
  await db.update(groups).set({ lockAfterSubmit: enabled }).where(await thisTermsGroup(id));
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true };
}

/**
 * Re-point the default group: the one the sweep/self-add hook drop ungrouped
 * students into (PLAN §13). Exactly one group holds the flag; flipping it is
 * transactional so a crash can't leave zero or two defaults.
 */
export async function setDefaultGroup(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const db = getDb();
  const termId = await workingTermId();
  const [g] = await db
    .select({ id: groups.id, kind: groups.kind })
    .from(groups)
    .where(await thisTermsGroup(id))
    .limit(1);
  if (!g) return { ok: false, error: "Group not found." };
  if (g.kind === "test") {
    return { ok: false, error: "The test-accounts group can't be the default." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(groups)
      .set({ isDefault: false })
      .where(and(eq(groups.isDefault, true), eq(groups.termId, termId)));
    await tx.update(groups).set({ isDefault: true }).where(eq(groups.id, id));
  });
  revalidateGroups();
  return { ok: true };
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const db = getDb();
  const [g] = await db
    .select({ isDefault: groups.isDefault, kind: groups.kind })
    .from(groups)
    .where(await thisTermsGroup(id))
    .limit(1);
  if (!g) return { ok: false, error: "Group not found." };
  if (g.kind === "test") {
    // Deleting it would empty its members' group, stranding test accounts the
    // /admin/test-users manager could no longer list or delete.
    return { ok: false, error: "The test-accounts group is managed on /admin/test-users and can't be deleted." };
  }
  if (g.isDefault) {
    return { ok: false, error: "The default group can't be deleted. Make another group the default first." };
  }

  // Members' group is set null by the FK (onDelete: set null) → they revert
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
  const [g] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(await thisTermsGroup(groupId))
    .limit(1);
  if (!g) return { ok: false, error: "Group not found." };

  // Only people who exist: a membership row needs a student behind it.
  const known = await db
    .select({ email: students.email })
    .from(students)
    .where(inArray(students.email, normalized));
  await assignMembers(
    db,
    await workingTermId(),
    known.map((s) => s.email),
    groupId,
    false,
  );
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
  const [g] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(await thisTermsGroup(groupId))
    .limit(1);
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

  await assignMembers(db, await workingTermId(), matchedEmails, groupId, false);
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true, assigned: matchedEmails.length, unmatched, invalid };
}

/** Remove students from their group this term (keeps the sticky marker). */
export async function unassignStudents(emails: string[]): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (normalized.length === 0) return { ok: false, error: "Select at least one student." };

  await unassignMembers(getDb(), await workingTermId(), normalized);
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
 * (sticky). A no-op when the toggle is off. Idempotent: already-grouped and
 * already-auto students are skipped.
 */
export async function runDefaultAssignmentSweep(): Promise<SweepResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error, enabled: false, swept: 0 };

  const enabled = await getDefaultAutoAssignEnabled();
  if (!enabled) return { ok: true, enabled: false, swept: 0 };

  const target = await getDefaultGroup();
  if (!target) return { ok: false, error: "No default group is set.", enabled: true, swept: 0 };

  const db = getDb();
  const termId = await workingTermId();
  const targets = await listUnsweptEmails(db, termId);
  await assignMembers(db, termId, targets, target.id, true);
  revalidateGroups();
  revalidatePath("/availability");
  return { ok: true, enabled: true, swept: targets.length };
}
