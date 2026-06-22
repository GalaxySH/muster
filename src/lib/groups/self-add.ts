/**
 * Dormant hook for the future non-roster self-add flow (PLAN.md §13, §11).
 *
 * When a verified-`@wisc.edu` student who isn't on the roster self-adds (via the
 * failed-Google / magic-link path), that flow will create their `students` row
 * and then call this to grant the default-group window **immediately** — but
 * only if the default-assignment toggle is on (otherwise they stay ungrouped =
 * denied, the secure default). There is no caller yet; this defines the contract
 * the self-add flow will plug into so the gate is consistent with the admin
 * sweep. Marked auto (sticky) like a swept assignment.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/auth/policy";
import { getDefaultAutoAssignEnabled } from "./data";
import { DEFAULT_GROUP_ID } from "./constants";

/**
 * Assign the default group to a just-self-added student if auto-assignment is
 * enabled. The student row must already exist. No-op (denied) when the toggle is
 * off. Returns whether a group was assigned.
 */
export async function applyDefaultGroupOnSelfAdd(emailRaw: string): Promise<boolean> {
  if (!(await getDefaultAutoAssignEnabled())) return false;
  const db = getDb();
  const email = normalizeEmail(emailRaw);
  await db
    .update(students)
    .set({ groupId: DEFAULT_GROUP_ID, groupAssignedAuto: true })
    .where(eq(students.email, email));
  return true;
}
