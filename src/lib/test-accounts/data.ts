import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, submissions } from "@/lib/db/schema";
import { POSITIONS } from "@/lib/config/positions";
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

const positionName = (id: string | null) => POSITIONS.find((p) => p.id === id)?.name ?? null;

/** The throwaway accounts created by the /admin/test-users manager (test-group members). */
export async function listTestAccounts(): Promise<TestAccount[]> {
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      positionId: students.positionId,
      status: submissions.status,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .where(eq(students.groupId, TEST_GROUP_ID))
    .orderBy(students.email);

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionName: positionName(r.positionId),
    status: r.status ?? null,
    canSignInAs: isTestAccountEmail(r.email),
  }));
}
