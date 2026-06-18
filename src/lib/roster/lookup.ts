/**
 * Roster linking on sign-in (PLAN.md §4.1 step 2).
 *
 * Resolves a signed-in identity to its roster record by email (the netid
 * `@wisc.edu` address equals the Google sign-in identity — confirmed §16.1),
 * and checks the imported admin allowlist.
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

/** True if the email is in the roster-imported admin_users table. */
export async function isAdminInDb(email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ email: adminUsers.email })
    .from(adminUsers)
    .where(eq(adminUsers.email, normalizeEmail(email)))
    .limit(1);
  return rows.length > 0;
}
