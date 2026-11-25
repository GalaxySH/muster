"use server";

/**
 * Admin actions for schedule change requests (roadmap 3.1): mark a request
 * resolved once the W2W schedule was updated (or reopen it), fix a request's
 * wording, or delete it outright. Withdrawn requests belong to the student and
 * stay withdrawn.
 */
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { changeRequestFiles, changeRequests } from "@/lib/db/schema";
import { requireAdmin, requireAdminIn } from "@/lib/auth/require-admin";
import { currentTermId } from "@/lib/terms/working";
import { normalizeEmail } from "@/lib/auth/policy";
import { relayDelete } from "@/lib/drive/relay";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadPositionWithBlocks } from "@/lib/availability/data";
import { validateChangeRequest, type ShiftTimeBlock } from "@/lib/domain/change-requests";
import { listChangeRequests, type ChangeRequestRow } from "./data";

/**
 * Whose requests the form panel shows, and from which semester. The same rule
 * as filing one (changes/actions.ts): with nobody picked (null) it is the
 * signed-in admin's own, in the current semester. Anyone picked, the admin
 * included, is read in the semester the page was rendered for.
 */
async function panelTarget(
  email: string | null,
  termId: string,
): Promise<{ email: string; termId: string } | null> {
  if (!email) {
    const gate = await requireAdmin();
    return gate.ok ? { email: gate.email, termId: await currentTermId() } : null;
  }
  const gate = await requireAdminIn(termId);
  return gate.ok ? { email: normalizeEmail(email), termId: gate.termId } : null;
}

/** The requests of whoever the form panel acts for (the list follows the form). */
export async function adminListChangeRequests(
  email: string | null,
  termId: string,
): Promise<ChangeRequestRow[]> {
  const target = await panelTarget(email, termId);
  return target ? listChangeRequests(target.email, target.termId) : [];
}

/**
 * The live blocks of the position of whoever the form panel acts for, for the
 * quick-insert shift times. Empty without a position.
 */
export async function adminShiftTimeBlocks(
  email: string | null,
  termId: string,
): Promise<ShiftTimeBlock[]> {
  const target = await panelTarget(email, termId);
  if (!target) return [];
  const student = await findStudentByEmail(target.email, target.termId);
  if (!student?.positionId) return [];
  const loaded = await loadPositionWithBlocks(student.positionId);
  return (loaded?.blocks ?? []).map(({ dayType, start, end }) => ({ dayType, start, end }));
}

export interface AdminChangeRequestResult {
  ok: boolean;
  error?: string;
}

const GONE = "This request no longer exists.";

/**
 * Who filed the request, when it is one of this term's. The row actions pass
 * the term their gate proved is the page's, so a page left open on another
 * semester is told so before this runs.
 */
async function requestOwner(id: string, termId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ studentEmail: changeRequests.studentEmail })
    .from(changeRequests)
    .where(and(eq(changeRequests.id, id), eq(changeRequests.termId, termId)))
    .limit(1);
  return row?.studentEmail ?? null;
}

function revalidateRequestViews(studentEmail: string) {
  revalidatePath(`/admin/students/${encodeURIComponent(studentEmail)}`);
  revalidatePath("/admin/change-requests");
  revalidatePath("/change-requests");
}

export async function setChangeRequestResolved(
  id: string,
  resolved: boolean,
  termId: string,
): Promise<AdminChangeRequestResult> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const owner = await requestOwner(id, gate.termId);
  if (!owner) return { ok: false, error: GONE };

  await getDb()
    .update(changeRequests)
    .set({ status: resolved ? "resolved" : "open" })
    .where(and(eq(changeRequests.id, id), ne(changeRequests.status, "withdrawn")));

  revalidateRequestViews(owner);
  return { ok: true };
}

/**
 * Rewrite a request's day, shift time, comment, and permanence. Its status,
 * creation time, and digest stamp stay as they were.
 */
export async function updateChangeRequest(
  id: string,
  input: { day: string; shiftText: string; comment: string; permanent: boolean },
  termId: string,
): Promise<AdminChangeRequestResult> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const checked = validateChangeRequest({ ...input, permanent: input.permanent === true });
  if (!checked.ok) return { ok: false, error: checked.error };

  const owner = await requestOwner(id, gate.termId);
  if (!owner) return { ok: false, error: GONE };

  await getDb().update(changeRequests).set(checked.value).where(eq(changeRequests.id, id));

  revalidateRequestViews(owner);
  return { ok: true };
}

/**
 * Delete a request for good. Its file rows cascade with it; the Drive proofs
 * are gathered first and cleaned up after the row is gone (best effort, the
 * same order removing a travel entry uses).
 */
export async function deleteChangeRequest(
  id: string,
  termId: string,
): Promise<AdminChangeRequestResult> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const owner = await requestOwner(id, gate.termId);
  if (!owner) return { ok: false, error: GONE };

  const db = getDb();
  const files = await db
    .select({ fileId: changeRequestFiles.fileId })
    .from(changeRequestFiles)
    .where(eq(changeRequestFiles.changeRequestId, id));

  await db.delete(changeRequests).where(eq(changeRequests.id, id));
  for (const f of files) await relayDelete(f.fileId);

  revalidateRequestViews(owner);
  return { ok: true };
}
