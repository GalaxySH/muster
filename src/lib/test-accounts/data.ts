import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, students, submissions, termMembers } from "@/lib/db/schema";
import { isTestAccountEmail } from "./email";
import { workingTermId } from "@/lib/terms/working";
import { submissionOfStudent, memberOf } from "@/lib/terms/scope";
import { inTestGroup } from "@/lib/groups/membership";

export interface TestAccount {
  email: string;
  displayName: string;
  positionName: string | null;
  status: "draft" | "submitted" | null;
  /**
   * Only synthetic-domain accounts can be signed in as or deleted. False for
   * anyone else in the test group, such as a real student moved there.
   */
  canManage: boolean;
}

/** The throwaway accounts created by the /admin/test-users manager (test-group members). */
export async function listTestAccounts(): Promise<TestAccount[]> {
  // Joining positions (rather than filtering a picker list) keeps names
  // resolving even when an account holds an inactive or aliased position.
  const termId = await workingTermId();
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      positionName: positions.name,
      status: submissions.status,
    })
    .from(students)
    .innerJoin(termMembers, memberOf(termId))
    .leftJoin(submissions, submissionOfStudent(termId))
    .leftJoin(positions, eq(termMembers.positionId, positions.id))
    .where(inTestGroup(termId))
    .orderBy(students.email);

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionName: r.positionName ?? null,
    status: r.status ?? null,
    canManage: isTestAccountEmail(r.email),
  }));
}
