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
import { requireAdmin, requireAdminIn, type AdminInTerm } from "@/lib/auth/require-admin";
import { currentTermId } from "@/lib/terms/working";
import { normalizeEmail } from "@/lib/auth/policy";
import { relayDelete } from "@/lib/drive/relay";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadPositionWithBlocks } from "@/lib/availability/data";
import { validateChangeRequest, type ShiftTimeBlock } from "@/lib/domain/change-requests";
import { listChangeRequests, type ChangeRequestRow } from "./data";

/**
 * The panel also lists the admin's own requests, when the form acts for nobody.
 * Those are filed in the current semester like anyone's own (changes/actions.ts),
 * so they are read from it too. Anyone else is read in the semester worked in.
 */
const ownOrWorkingTerm = async (email: string, gate: AdminInTerm): Promise<string> =>
  email === gate.email ? currentTermId() : gate.termId;

/**
 * One employee's requests, for the form panel when an admin picks an employee
 * to act for (the panel's list follows whoever the form targets). The same
 * person is in every term, so the page says which term it is showing.
 */
export async function adminListChangeRequests(
  email: string,
  termId: string,
): Promise<ChangeRequestRow[]> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return [];
  const who = normalizeEmail(email);
  return listChangeRequests(who, await ownOrWorkingTerm(who, gate));
}

/**
 * The live blocks of an employee's position, for the form's quick-insert shift
 * times when an admin picks someone to act for. Empty without a position.
 */
export async function adminShiftTimeBlocks(
  email: string,
  termId: string,
): Promise<ShiftTimeBlock[]> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return [];
  const who = normalizeEmail(email);
  const student = await findStudentByEmail(who, await ownOrWorkingTerm(who, gate));
  if (!student?.positionId) return [];
  const loaded = await loadPositionWithBlocks(student.positionId);
  return (loaded?.blocks ?? []).map(({ dayType, start, end }) => ({ dayType, start, end }));
}

export interface AdminChangeRequestResult {
  ok: boolean;
  error?: string;
}

const GONE = "This request no longer exists.";

async function requestOwner(id: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ studentEmail: changeRequests.studentEmail })
    .from(changeRequests)
    .where(eq(changeRequests.id, id))
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
): Promise<AdminChangeRequestResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const owner = await requestOwner(id);
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
): Promise<AdminChangeRequestResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const checked = validateChangeRequest({ ...input, permanent: input.permanent === true });
  if (!checked.ok) return { ok: false, error: checked.error };

  const owner = await requestOwner(id);
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
export async function deleteChangeRequest(id: string): Promise<AdminChangeRequestResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const owner = await requestOwner(id);
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
