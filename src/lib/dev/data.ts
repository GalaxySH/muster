import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, submissions } from "@/lib/db/schema";
import { POSITIONS } from "@/lib/config/positions";
import { DEV_GROUP_ID } from "./constants";

export interface DevStudent {
  email: string;
  displayName: string;
  positionName: string | null;
  status: "draft" | "submitted" | null;
}

const positionName = (id: string | null) => POSITIONS.find((p) => p.id === id)?.name ?? null;

/** The throwaway accounts created by the /dev-login manager (dev group members). */
export async function listDevStudents(): Promise<DevStudent[]> {
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      positionId: students.positionId,
      status: submissions.status,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .where(eq(students.groupId, DEV_GROUP_ID))
    .orderBy(students.email);

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionName: positionName(r.positionId),
    status: r.status ?? null,
  }));
}
