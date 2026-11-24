"use server";

/**
 * The two writes the Google Form paste import (docs/form-paste.md) needs that no
 * existing on-behalf action covers. Everything else the import applies goes
 * through the per-student actions the page already uses (hours, notes, uploads,
 * travel), so the rules on those stay in one place.
 *
 * Both are admin-only and leave `updated_at` alone: it means the student last
 * changed their answers in Muster (PLAN §9), and a paste isn't that.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { ensureSubmissionId } from "@/lib/evidence/data";
import { syncRevalidationFlag } from "@/lib/positions/apply-change";
import { trySyncSheet, RESPONSES_SHEET } from "./sheet-sync";
import type { AdminActionResult } from "./actions";
import { currentTermId } from "@/lib/terms/current";
import { submissionOf } from "@/lib/terms/scope";

interface Target {
  email: string;
  existing?: { id: string; status: "draft" | "submitted"; submittedVia: "muster" | "google_form" };
}

/** The admin gate, the roster check, and the student's submission row if they have one. */
async function target(student: string): Promise<Target | { error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };
  const email = normalizeEmail(student);
  // submissions.studentEmail is a foreign key, so check the roster first.
  if (!(await findStudentByEmail(email))) return { error: "That employee is not a known student." };
  const [existing] = await getDb()
    .select({
      id: submissions.id,
      status: submissions.status,
      submittedVia: submissions.submittedVia,
    })
    .from(submissions)
    .where(submissionOf(email, await currentTermId()))
    .limit(1);
  return { email, existing };
}

function refresh(email: string) {
  revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  revalidatePath("/admin/responses");
}

/**
 * Set the student's own every-weekend answer. It is one of the inputs to the
 * `revalidation_failed` check, so an existing response re-syncs that flag, the
 * same as `saveDesiredHoursFor`.
 */
export async function saveEveryWeekendFor(
  student: string,
  optIn: boolean,
): Promise<AdminActionResult> {
  const t = await target(student);
  if ("error" in t) return { ok: false, error: t.error };

  const submissionId = t.existing?.id ?? (await ensureSubmissionId(t.email));
  await getDb().transaction(async (tx) => {
    await tx
      .update(submissions)
      .set({ everyWeekendOptIn: optIn })
      .where(eq(submissions.id, submissionId));
    if (t.existing) await syncRevalidationFlag(tx, submissionId);
  });
  if (t.existing?.status === "submitted") await trySyncSheet(RESPONSES_SHEET);
  refresh(t.email);
  return { ok: true };
}

/**
 * Count a pasted Google Form response as the student's response: submitted, via
 * Google Form, with the form's timestamp as the submit time. A response the
 * student already submitted in Muster is left alone. Pasting a newer form
 * response moves the submit time to it.
 */
export async function recordFormResponse(
  student: string,
  submittedAtIso: string | null,
): Promise<AdminActionResult> {
  const t = await target(student);
  if ("error" in t) return { ok: false, error: t.error };
  if (t.existing?.status === "submitted" && t.existing.submittedVia === "muster") {
    return { ok: false, error: "They already submitted in Muster." };
  }

  const stamp = submittedAtIso ? new Date(submittedAtIso) : null;
  const submittedAt = stamp && !Number.isNaN(stamp.getTime()) ? stamp : new Date();
  const submissionId = t.existing?.id ?? (await ensureSubmissionId(t.email));
  await getDb()
    .update(submissions)
    .set({ status: "submitted", submittedVia: "google_form", submittedAt })
    .where(eq(submissions.id, submissionId));
  await trySyncSheet(RESPONSES_SHEET);
  refresh(t.email);
  return { ok: true };
}
