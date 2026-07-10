"use server";

/**
 * Admin actions for schedule change requests (roadmap 3.1): mark a request
 * resolved once the W2W schedule was updated (or reopen it). Withdrawn
 * requests belong to the student and stay withdrawn.
 */
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { changeRequests } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import { listChangeRequests, type ChangeRequestRow } from "./data";

/**
 * One employee's requests, for the form panel when an admin picks an employee
 * to act for (the panel's list follows whoever the form targets).
 */
export async function adminListChangeRequests(email: string): Promise<ChangeRequestRow[]> {
  const gate = await requireAdmin();
  if (!gate.ok) return [];
  return listChangeRequests(normalizeEmail(email));
}

export interface ResolveChangeRequestResult {
  ok: boolean;
  error?: string;
}

export async function setChangeRequestResolved(
  id: string,
  resolved: boolean,
): Promise<ResolveChangeRequestResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [row] = await db
    .select({ studentEmail: changeRequests.studentEmail })
    .from(changeRequests)
    .where(eq(changeRequests.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "This request no longer exists." };

  await db
    .update(changeRequests)
    .set({ status: resolved ? "resolved" : "open" })
    .where(and(eq(changeRequests.id, id), ne(changeRequests.status, "withdrawn")));

  revalidatePath(`/admin/students/${encodeURIComponent(row.studentEmail)}`);
  revalidatePath("/admin/change-requests");
  return { ok: true };
}
