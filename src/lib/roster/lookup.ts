/**
 * Roster linking on sign-in (PLAN.md §4.1 step 2).
 *
 * Resolves a signed-in identity to its roster record by email (the netid
 * `@wisc.edu` address equals the Google sign-in identity, confirmed §16.1),
 * and checks the imported admin allowlist.
 *
 * A person is one `students` row; their position and roster flag belong to a
 * term and live in `term_members` (docs/semester-domains-plan.md §2.3). The
 * record this hands back is the person together with their place in the
 * current term, which is what every form and admin action works with.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, adminUsers, termMembers } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/auth/policy";
import { workingTermId } from "@/lib/terms/working";
import { memberOf, onRosterStudent } from "@/lib/terms/scope";

/** A person and their place in the working term. */
export interface StudentRecord {
  email: string;
  displayName: string;
  international: boolean;
  hiredOn: Date | null;
  lastSeenAt: Date | null;
  /** Their position this term; null when they have none or are not part of it. */
  positionId: string | null;
  /** False for someone who left, and for someone who was never part of this term. */
  onRoster: boolean;
  rosterTitle: string | null;
}

/** The person with this email and their place in the working term, or null when unknown. */
export async function findStudentByEmail(email: string): Promise<StudentRecord | null> {
  const [row] = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      international: students.international,
      hiredOn: students.hiredOn,
      lastSeenAt: students.lastSeenAt,
      positionId: termMembers.positionId,
      onRoster: termMembers.onRoster,
      rosterTitle: termMembers.rosterTitle,
    })
    .from(students)
    .leftJoin(termMembers, memberOf(await workingTermId()))
    .where(eq(students.email, normalizeEmail(email)))
    .limit(1);
  return row ? { ...row, onRoster: row.onRoster ?? false } : null;
}

/**
 * The name of a known person, or null. Reads the person only, never the term:
 * the sign-in path uses it, and a term problem must not break signing in.
 */
export async function findPersonName(email: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ displayName: students.displayName })
    .from(students)
    .where(eq(students.email, normalizeEmail(email)))
    .limit(1);
  return row?.displayName ?? null;
}

/** Every on-roster name and email, by name: the header's student finder lists these. */
export async function listRosterNames(): Promise<{ email: string; displayName: string }[]> {
  return getDb()
    .select({ email: students.email, displayName: students.displayName })
    .from(students)
    .where(onRosterStudent(await workingTermId()))
    .orderBy(asc(students.displayName), asc(students.email));
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
