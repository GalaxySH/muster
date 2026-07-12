import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, students, submissions } from "@/lib/db/schema";
import { TEST_GROUP_ID } from "./constants";
import { isTestAccountEmail } from "./email";

export interface TestAccount {
  email: string;
  displayName: string;
  positionName: string | null;
  status: "draft" | "submitted" | null;
  /** False for legacy dev-created @wisc.edu accounts; hides the sign-in-as button. */
  canSignInAs: boolean;
}

/** The throwaway accounts created by the /admin/test-users manager (test-group members). */
export async function listTestAccounts(): Promise<TestAccount[]> {
  // Joining positions (rather than filtering a picker list) keeps names
  // resolving even when an account holds an inactive or aliased position.
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      positionName: positions.name,
      status: submissions.status,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .leftJoin(positions, eq(students.positionId, positions.id))
    .where(eq(students.groupId, TEST_GROUP_ID))
    .orderBy(students.email);

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionName: r.positionName ?? null,
    status: r.status ?? null,
    canSignInAs: isTestAccountEmail(r.email),
  }));
}
