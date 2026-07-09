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
