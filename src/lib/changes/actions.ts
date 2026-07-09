"use server";

/**
 * Student actions for schedule change requests (roadmap 3.1). Deliberately
 * NOT gated on group/window (unlike the wizard actions): the mini-flow is
 * usable all semester by any known student. The gate is only session + a
 * roster row; abuse is bounded by the pure rolling rate cap.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { changeRequests } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { changeRequestRate, validateChangeRequest } from "@/lib/domain/change-requests";
import { listChangeRequests, recentChangeRequestTimes, type ChangeRequestRow } from "./data";

export interface ChangeRequestActionResult {
  ok: boolean;
  error?: string;
  /** The refreshed list (also on errors, so the UI stays current). */
  requests: ChangeRequestRow[] | null;
}

async function gateKnownStudent(): Promise<
  { ok: true; email: string } | { ok: false; error: string }
> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };
  const student = await findStudentByEmail(session.email);
  if (!student) return { ok: false, error: "You are not a known student." };
  return { ok: true, email: student.email };
}

export async function createChangeRequest(input: {
  day: string;
  shiftText: string;
  comment: string;
}): Promise<ChangeRequestActionResult> {
  const gate = await gateKnownStudent();
  if (!gate.ok) return { ok: false, error: gate.error, requests: null };
  const email = gate.email;

  const checked = validateChangeRequest(input);
  if (!checked.ok) {
    return { ok: false, error: checked.error, requests: await listChangeRequests(email) };
  }

  const now = new Date();
  const rate = changeRequestRate(await recentChangeRequestTimes(email, now), now);
  if (!rate.allowed) {
    return {
      ok: false,
      error: "You have sent several requests recently. Try again later.",
      requests: await listChangeRequests(email),
    };
  }

  await getDb().insert(changeRequests).values({
    id: randomUUID(),
    studentEmail: email,
    day: checked.value.day,
    shiftText: checked.value.shiftText,
    comment: checked.value.comment,
  });
  revalidatePath("/change-requests");
  return { ok: true, requests: await listChangeRequests(email) };
}

/** Withdraw one of the student's own open requests. */
export async function withdrawChangeRequest(id: string): Promise<ChangeRequestActionResult> {
  const gate = await gateKnownStudent();
  if (!gate.ok) return { ok: false, error: gate.error, requests: null };

  await getDb()
    .update(changeRequests)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(changeRequests.id, id),
        eq(changeRequests.studentEmail, gate.email),
        eq(changeRequests.status, "open"),
      ),
    );
  revalidatePath("/change-requests");
  return { ok: true, requests: await listChangeRequests(gate.email) };
}
