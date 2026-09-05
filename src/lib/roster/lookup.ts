/**
 * Roster linking on sign-in (PLAN.md §4.1 step 2).
 *
 * Resolves a signed-in identity to its roster record by email (the netid
 * `@wisc.edu` address equals the Google sign-in identity, confirmed §16.1),
 * and checks the imported admin allowlist.
 *
 * It also holds the one definition of "on the roster", because every module
 * needs it. Being listed on the imported tracker is what puts someone on the
 * roster, and dropping off it is what takes them off (PLAN §4.2). Someone who
 * left is not schedulable, so the generator, W2W and the console all filter on
 * this, and a missed copy readmits a departed student into a coverage count, a
 * schedule view, or a W2W upload.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, adminUsers } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/auth/policy";

export type StudentRecord = typeof students.$inferSelect;

/** The roster row for this email, or null (off-roster / not yet onboarded). */
export async function findStudentByEmail(email: string): Promise<StudentRecord | null> {
  const rows = await getDb()
    .select()
    .from(students)
    .where(eq(students.email, normalizeEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

/** Query filter for roster members: `.where(onRosterStudent())`. */
export function onRosterStudent() {
  return eq(students.onRoster, true);
}

/** True if the email is in the roster-imported admin_users table. */
export async function isAdminInDb(email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ email: adminUsers.email })
    .from(adminUsers)
    .where(eq(adminUsers.email, normalizeEmail(email)))
    .limit(1);
  return rows.length > 0;
}
