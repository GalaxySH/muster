"use server";

/**
 * Student actions for schedule change requests (roadmap 3.1). Deliberately
 * NOT gated on group/window (unlike the wizard actions): the mini-flow is
 * usable all semester by any known student. The gate is only session + a
 * roster row; abuse is bounded by the pure rolling rate cap. Admins can
 * additionally act for an employee (the form's employee field): creating on
 * their behalf (rate cap skipped) and withdrawing any open request.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { changeRequestFiles, changeRequests } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import {
  changeRequestRate,
  validateChangeRequest,
  MAX_CHANGE_REQUEST_FILES,
} from "@/lib/domain/change-requests";
import { validateEvidenceUpload } from "@/lib/drive/upload-validation";
import { relayUpload, relayDelete, NoDriveGrantError } from "@/lib/drive/relay";
import { listChangeRequests, recentChangeRequestTimes, type ChangeRequestRow } from "./data";

export interface ChangeRequestActionResult {
  ok: boolean;
  error?: string;
  /** The refreshed list (also on errors, so the UI stays current). */
  requests: ChangeRequestRow[] | null;
}

/**
 * Whose request is this? Normally the signed-in student's own; an admin may
 * instead name an employee (any known student) to act for.
 */
async function resolveTargetStudent(
  onBehalfOf: string,
): Promise<
  { ok: true; email: string; onBehalf: boolean; isAdmin: boolean } | { ok: false; error: string }
> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in." };

  if (onBehalfOf) {
    if (!session.isAdmin) {
      return { ok: false, error: "Only admins can send a request for someone else." };
    }
    const employee = await findStudentByEmail(onBehalfOf);
    if (!employee) return { ok: false, error: "That employee is not a known student." };
    return { ok: true, email: employee.email, onBehalf: true, isAdmin: true };
  }

  const student = await findStudentByEmail(session.email);
  if (!student) {
    return {
      ok: false,
      error: session.isAdmin ? "Pick an employee for this request." : "You are not a known student.",
    };
  }
  return { ok: true, email: student.email, onBehalf: false, isAdmin: session.isAdmin };
}

export async function createChangeRequest(formData: FormData): Promise<ChangeRequestActionResult> {
  const gate = await resolveTargetStudent(String(formData.get("employee") ?? "").trim());
  if (!gate.ok) return { ok: false, error: gate.error, requests: null };
  const email = gate.email;
  const fail = async (error: string): Promise<ChangeRequestActionResult> => ({
    ok: false,
    error,
    requests: await listChangeRequests(email),
  });

  const checked = validateChangeRequest({
    day: String(formData.get("day") ?? ""),
    shiftText: String(formData.get("shiftText") ?? ""),
    comment: String(formData.get("comment") ?? ""),
    permanent: formData.get("permanent") === "1",
  });
  if (!checked.ok) return fail(checked.error);

  // Admin only: record the request as already handled (e.g. logging a change
  // that was applied in W2W on the spot). Ignored for students, so a forged
  // form field can never self-resolve; resolved rows also skip the digest.
  const markResolved = gate.isAdmin && formData.get("resolved") === "1";

  // Optional supporting proof: validate every file before any byte is relayed.
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_CHANGE_REQUEST_FILES) {
    return fail(`Attach at most ${MAX_CHANGE_REQUEST_FILES} files.`);
  }
  for (const file of files) {
    const check = validateEvidenceUpload({ type: file.type, size: file.size });
    if (!check.ok) return fail(check.error ?? "Invalid file.");
  }

  // The rate cap bounds student abuse; an admin entering a request on an
  // employee's behalf is never blocked by it.
  if (!gate.onBehalf) {
    const now = new Date();
    const rate = changeRequestRate(await recentChangeRequestTimes(email, now), now);
    if (!rate.allowed) {
      return fail("You have sent several requests recently. Try again later.");
    }
  }

  // Relay the proofs; if one fails, remove the ones already stored so nothing orphans.
  const fileIds: string[] = [];
  try {
    for (const file of files) {
      fileIds.push(
        await relayUpload({
          studentEmail: email,
          kind: "change-request",
          mimeType: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        }),
      );
    }
  } catch (e) {
    for (const fileId of fileIds) await relayDelete(fileId);
    if (e instanceof NoDriveGrantError) return fail(e.message);
    console.error("Change-request proof relay failed:", e);
    return fail("Upload failed. Please try again.");
  }

  const db = getDb();
  const requestId = randomUUID();
  await db.insert(changeRequests).values({
    id: requestId,
    studentEmail: email,
    day: checked.value.day,
    shiftText: checked.value.shiftText,
    comment: checked.value.comment,
    permanent: checked.value.permanent,
    status: markResolved ? "resolved" : "open",
  });
  if (fileIds.length > 0) {
    await db.insert(changeRequestFiles).values(
      fileIds.map((fileId) => ({ id: randomUUID(), changeRequestId: requestId, fileId })),
    );
  }
  revalidatePath("/change-requests");
  if (gate.onBehalf) revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  return { ok: true, requests: await listChangeRequests(email) };
}

/**
 * Withdraw an open request: students withdraw their own, admins anyone's
 * (e.g. one they sent on an employee's behalf by mistake).
 */
export async function withdrawChangeRequest(id: string): Promise<ChangeRequestActionResult> {
  const session = await getAppSession();
  if (!session) return { ok: false, error: "You are not signed in.", requests: null };

  const db = getDb();
  const [row] = await db
    .select({ studentEmail: changeRequests.studentEmail })
    .from(changeRequests)
    .where(eq(changeRequests.id, id))
    .limit(1);
  if (!row || (!session.isAdmin && row.studentEmail !== session.email)) {
    return { ok: false, error: "That request is not yours to withdraw.", requests: null };
  }

  await db
    .update(changeRequests)
    .set({ status: "withdrawn" })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.status, "open")));
  revalidatePath("/change-requests");
  return { ok: true, requests: await listChangeRequests(row.studentEmail) };
}
