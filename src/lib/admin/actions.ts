"use server";

/**
 * Admin-only mutations from the per-student view (PLAN.md §10a): the
 * "mark scheduled ✓" progress toggle and free-text scheduler notes. Both are
 * admin-gated and operate on the target student's submission. They never touch
 * the student's availability data.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { flags, submissions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { collectSubmissionDriveFileIds, ensureSubmissionId } from "@/lib/evidence/data";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { normalizeEmail } from "@/lib/auth/policy";
import { relayDelete } from "@/lib/drive/relay";
import {
  setSetting,
  deleteSetting,
  SETTING_TRAVEL_CUTOFF,
  SETTING_EMAIL_SENDING_ENABLED,
  SETTING_CHANGE_DIGEST_ENABLED,
  SETTING_CHANGE_DIGEST_RECIPIENTS,
} from "@/lib/settings";
import { parseEmailList } from "@/lib/groups/parse-emails";
import { isEmailShaped } from "@/lib/auth/policy";
import {
  syncSheet,
  RESPONSES_SHEET,
  SHEET_MANUAL_COOLDOWN_MS,
  type SheetSyncResult,
} from "./sheet-sync";

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Updates the student's submission, creating an empty draft first if they never
 * started one: a scheduler must be able to put notes and a "scheduled" mark on
 * anyone on the roster, whether or not they ever filled the form in. The draft
 * this creates has no confirmedAt, so the student still counts as a
 * non-responder everywhere (see `responseStatus` in ./data).
 */
async function updateSubmission(
  studentEmail: string,
  patch: Partial<typeof submissions.$inferInsert>,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const email = normalizeEmail(studentEmail);
  // submissions.studentEmail is a foreign key, so an unknown address would fail
  // as a DB error rather than something we can report.
  const student = await findStudentByEmail(email);
  if (!student) return { ok: false, error: "That employee is not a known student." };

  const submissionId = await ensureSubmissionId(email);
  await getDb().update(submissions).set(patch).where(eq(submissions.id, submissionId));
  revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  revalidatePath("/admin/responses");
  return { ok: true };
}

/** Toggle the W2W "scheduled" progress marker for a student (PLAN §10a). */
export async function setScheduled(
  studentEmail: string,
  scheduled: boolean,
): Promise<AdminActionResult> {
  return updateSubmission(studentEmail, { scheduled });
}

/** Save the scheduler's free-text notes for a student (PLAN §10a). */
export async function saveSchedulerNotes(
  studentEmail: string,
  notes: string,
): Promise<AdminActionResult> {
  const trimmed = notes.trim();
  return updateSubmission(studentEmail, { schedulerNotes: trimmed.length ? trimmed : null });
}

/**
 * Admin: permanently delete a student's response (PLAN §10). Removes the
 * submission row (which cascades its shift selections, flags, extracurricular
 * file rows, and travel requests), then best-effort deletes every relayed proof
 * file from Drive (course schedule, extracurriculars, travel) so no orphaned
 * bytes are left behind, and rebuilds the running sheet so the row drops out.
 * The student record itself stays on the roster; only their submission is gone.
 */
export async function deleteResponse(studentEmail: string): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const email = normalizeEmail(studentEmail);
  const [sub] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);
  if (!sub) return { ok: false, error: "No submission exists for this student." };

  // Gather every Drive proof fileId before the cascade removes its rows.
  const fileIds = await collectSubmissionDriveFileIds(sub.id);

  await db.delete(submissions).where(eq(submissions.id, sub.id));

  // Best-effort Drive cleanup (relayDelete never throws) and sheet rebuild.
  for (const fileId of fileIds) await relayDelete(fileId);
  try {
    await syncSheet(RESPONSES_SHEET, { cooldownMs: 0 });
  } catch (e) {
    console.error("Sheet resync after delete failed (non-fatal):", e);
  }

  revalidatePath("/admin/responses");
  revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  return { ok: true };
}

/**
 * Admin: dismiss a submission's position_change flag(s) after reviewing the
 * change (roadmap 3.3). Deletes only that flag type; revalidation_failed has no
 * manual dismiss, it clears itself when a validation run passes.
 */
export async function clearPositionChangeFlag(submissionId: string): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [sub] = await db
    .select({ email: submissions.studentEmail })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!sub) return { ok: false, error: "No such submission." };

  await db
    .delete(flags)
    .where(and(eq(flags.submissionId, submissionId), eq(flags.type, "position_change")));

  revalidatePath(`/admin/students/${encodeURIComponent(sub.email)}`);
  revalidatePath("/admin/responses");
  return { ok: true };
}

/**
 * Set (an ISO instant) or clear (null ⇒ revert to the 9/1 default) the
 * travel-excusal cutoff (PLAN §8). After the cutoff the travel step refuses
 * new entries under the active late-travel policy (domain/travel.ts).
 */
export async function setTravelCutoff(iso: string | null): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  if (iso === null) {
    await deleteSetting(SETTING_TRAVEL_CUTOFF);
  } else {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Invalid date." };
    await setSetting(SETTING_TRAVEL_CUTOFF, d.toISOString());
  }
  revalidatePath("/admin/groups");
  revalidatePath("/travel");
  revalidatePath("/intro");
  return { ok: true };
}

/**
 * Master switch for outbound email (the /admin/email-settings toggle). When off,
 * `sendEmail` suppresses every message (sign-in links and batch notifications).
 */
export async function setEmailSendingEnabled(enabled: boolean): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  await setSetting(SETTING_EMAIL_SENDING_ENABLED, enabled ? "1" : "0");
  revalidatePath("/admin/email-settings");
  return { ok: true };
}

/** Toggle the daily schedule-change digest (roadmap 3.1; /admin/email-settings). */
export async function setChangeDigestEnabled(enabled: boolean): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  await setSetting(SETTING_CHANGE_DIGEST_ENABLED, enabled ? "1" : "0");
  revalidatePath("/admin/email-settings");
  return { ok: true };
}

export interface SaveDigestRecipientsResult extends AdminActionResult {
  /** The normalized list that was stored (on success). */
  saved?: string[];
}

/**
 * Set who receives the daily schedule-change digest (roadmap 3.1). The list is
 * admin data in app_settings — the ADMIN_EMAILS env allowlist plays no part in
 * digest delivery. Any well-formed address is accepted (not wisc-only); the
 * whole save is refused if any token is malformed so nothing drops silently.
 * An empty input clears the list, which silences the digest.
 */
export async function setChangeDigestRecipients(raw: string): Promise<SaveDigestRecipientsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { valid, invalid } = parseEmailList(raw, isEmailShaped);
  if (invalid.length > 0) {
    return { ok: false, error: `These don't look like email addresses: ${invalid.join(", ")}` };
  }

  if (valid.length === 0) await deleteSetting(SETTING_CHANGE_DIGEST_RECIPIENTS);
  else await setSetting(SETTING_CHANGE_DIGEST_RECIPIENTS, valid.join(","));
  revalidatePath("/admin/email-settings");
  return { ok: true, saved: valid };
}

export interface RebuildSheetResult extends AdminActionResult {
  sync?: SheetSyncResult;
}

/**
 * Admin: rebuild the running responses spreadsheet in Drive (PLAN §10, §12).
 * Obeys the short 30-second manual cooldown; returns the cooldown info so the UI
 * can say when the next rebuild is allowed.
 */
export async function rebuildResponsesSheet(): Promise<RebuildSheetResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    const sync = await syncSheet(RESPONSES_SHEET, { cooldownMs: SHEET_MANUAL_COOLDOWN_MS });
    revalidatePath("/admin/responses");
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sheet sync failed." };
  }
}
