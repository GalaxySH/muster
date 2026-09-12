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
import {
  flags,
  internalSelections,
  shiftSelections,
  submissions,
  travelRequests,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { syncRevalidationFlag } from "@/lib/positions/apply-change";
import { loadOrphanedCells, syncOrphanedSelectionFlag } from "@/lib/positions/orphans";
import type { Day } from "@/lib/domain/types";
import { issueMagicLink } from "@/lib/auth/magic-link-store";
import { env } from "@/lib/env";
import { collectSubmissionDriveFileIds, ensureSubmissionId } from "@/lib/evidence/data";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { normalizeEmail } from "@/lib/auth/policy";
import { relayDelete } from "@/lib/drive/relay";
import {
  setSetting,
  deleteSetting,
  SETTING_TRAVEL_CUTOFF,
  SETTING_LATE_TRAVEL_ACCEPT,
  SETTING_EMAIL_SENDING_ENABLED,
  SETTING_CHANGE_DIGEST_ENABLED,
  SETTING_CHANGE_DIGEST_RECIPIENTS,
  SETTING_CHANGE_REQUESTS_ENABLED,
  SETTING_HIGH_DEMAND_MARKS,
} from "@/lib/settings";
import { parseEmailList } from "@/lib/groups/parse-emails";
import { isEmailShaped } from "@/lib/auth/policy";
import { normalizeTitleList, SETTING_EXCLUDED_ROSTER_TITLES } from "@/lib/roster/position-mapping";
import {
  syncSheet,
  trySyncSheet,
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
 *
 * These are admin writes, so they must never touch `updated_at` — that column
 * means "when the student last changed their answers" (PLAN §9). Nothing here has
 * to opt out: the column is no longer `ON UPDATE CURRENT_TIMESTAMP`, so it moves
 * only when a caller sets it. Don't add it to `patch`.
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

export interface GenerateMagicLinkResult extends AdminActionResult {
  /** The assembled /magic/redeem URL (on success). */
  url?: string;
  /** The email the student must enter to activate the link (returned separately, not embedded). */
  email?: string;
}

/**
 * Admin: mint a single-use sign-in link for a student so an admin can hand it to
 * someone Google won't let in (PLAN §11). Same single-use expiring token as the
 * self-service flow (`issueMagicLink`), minted on demand with no cooldown since this
 * is an explicit admin action, not roster-probing input.
 *
 * The email is deliberately NOT embedded in the URL: redemption is bound to
 * token+email, so a link that leaks stays useless without the address. It is
 * returned separately for the caller to show as a reminder and pass along.
 */
export async function generateStudentMagicLink(
  studentEmail: string,
): Promise<GenerateMagicLinkResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const email = normalizeEmail(studentEmail);
  const student = await findStudentByEmail(email);
  if (!student) return { ok: false, error: "That employee is not a known student." };

  const token = await issueMagicLink(email);
  // Assemble the URL from our own base + redeem path, never a caller-supplied one.
  const url = `${env.NEXTAUTH_URL}/magic/redeem?token=${encodeURIComponent(token)}`;
  return { ok: true, url, email };
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
  await trySyncSheet(RESPONSES_SHEET, 0);

  revalidatePath("/admin/responses");
  revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  return { ok: true };
}

/**
 * The two flag types with a manual dismiss on the per-student flags pane:
 * position_change after the admin reviews the change (roadmap 3.3), and
 * student_changed_after_internal_edit when the admin decides to keep the
 * internal copy as it is (PLAN §10a). revalidation_failed has no manual
 * dismiss, it clears itself when a validation run passes.
 */
export type DismissableFlag = "position_change" | "student_changed_after_internal_edit";

/** Admin: dismiss a submission's flags of one dismissable type. */
export async function dismissFlag(
  submissionId: string,
  type: DismissableFlag,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [sub] = await db
    .select({ email: submissions.studentEmail })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!sub) return { ok: false, error: "No such submission." };

  await db.delete(flags).where(and(eq(flags.submissionId, submissionId), eq(flags.type, type)));

  revalidatePath(`/admin/students/${encodeURIComponent(sub.email)}`);
  revalidatePath("/admin/responses");
  return { ok: true };
}

/**
 * Admin: clear one orphaned pick, a cell on a shift that no longer exists
 * (PLAN §6.2a). Removed from the student's own rows and the internal copy
 * alike, since a dead shift is dead in both, then the orphan and revalidation
 * flags are re-synced: clearing the last one clears the flag.
 *
 * This is the only way an orphaned cell goes away. Students never see them, so
 * they can never remove one themselves, and nothing recomputes them away.
 */
export async function removeOrphanedSelection(
  studentEmail: string,
  blockId: string,
  day: Day,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const email = normalizeEmail(studentEmail);

  const db = getDb();
  const [sub] = await db
    .select({ id: submissions.id, status: submissions.status })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);
  if (!sub) return { ok: false, error: "No such submission." };

  let refused = false;
  await db.transaction(async (tx) => {
    // Refuse anything still live, so a bad id can never delete a real pick.
    // Checked inside the transaction: a concurrent "put back" would otherwise
    // make the shift live again between the check and the delete.
    const orphaned = await loadOrphanedCells(tx, sub.id);
    if (!orphaned.some((c) => c.blockId === blockId && c.day === day)) {
      refused = true;
      return;
    }
    const match = (table: typeof shiftSelections | typeof internalSelections) =>
      and(eq(table.submissionId, sub.id), eq(table.shiftBlockId, blockId), eq(table.day, day));
    await tx.delete(shiftSelections).where(match(shiftSelections));
    await tx.delete(internalSelections).where(match(internalSelections));
    await syncOrphanedSelectionFlag(tx, sub.id);
    await syncRevalidationFlag(tx, sub.id);
  });
  if (refused) return { ok: false, error: "That pick is not on a removed shift." };

  if (sub.status === "submitted") await trySyncSheet(RESPONSES_SHEET);
  revalidatePath(`/admin/students/${encodeURIComponent(email)}`);
  revalidatePath("/admin/responses");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Admin: mark one travel entry resolved once its trip is accounted for in the
 * schedule, or reopen it (PLAN §10a). This is the review marker, not the
 * cutoff-derived `excused` flag. Revalidates the per-student page, the upcoming
 * travel list, and the hub (its imminent-travel alert reads this).
 */
export async function setTravelResolved(id: string, resolved: boolean): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [row] = await db
    .select({ email: submissions.studentEmail })
    .from(travelRequests)
    .innerJoin(submissions, eq(travelRequests.submissionId, submissions.id))
    .where(eq(travelRequests.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "That travel entry no longer exists." };

  await db.update(travelRequests).set({ resolved }).where(eq(travelRequests.id, id));

  revalidatePath(`/admin/students/${encodeURIComponent(row.email)}`);
  revalidatePath("/admin/travel");
  revalidatePath("/admin");
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
 * Toggle the late-travel policy (PLAN §8; /admin/groups, beside the cutoff).
 * On, the travel step keeps accepting entries after the cutoff but stores them
 * unexcused ("accept-and-flag"); off restores the default "refuse". The hub's
 * cutoff-past alert reads this too.
 */
export async function setLateTravelAccepted(accepted: boolean): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  await setSetting(SETTING_LATE_TRAVEL_ACCEPT, accepted ? "1" : "0");
  revalidatePath("/admin/groups");
  revalidatePath("/travel");
  revalidatePath("/admin");
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

/**
 * Toggle whether students see the high-demand marks on the availability grid
 * (/admin/groups). Off drops the marks and their legend from the student form;
 * the admin grids keep them either way.
 */
export async function setHighDemandMarksEnabled(enabled: boolean): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  await setSetting(SETTING_HIGH_DEMAND_MARKS, enabled ? "1" : "0");
  revalidatePath("/admin/groups");
  revalidatePath("/availability");
  return { ok: true };
}

/**
 * Toggle whether the student-facing change-request form is offered
 * (/admin/change-requests). Off hides the /me card and swaps the /intro copy
 * to point at email instead; the form route and the admin queue stay reachable
 * either way, so nothing already submitted is affected.
 */
export async function setChangeRequestsEnabled(enabled: boolean): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  await setSetting(SETTING_CHANGE_REQUESTS_ENABLED, enabled ? "1" : "0");
  revalidatePath("/admin/change-requests");
  revalidatePath("/me");
  revalidatePath("/intro");
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

export interface SaveExcludedTitlesResult extends AdminActionResult {
  /** The normalized list that was stored (on success). */
  saved?: string[];
}

/**
 * Set the roster titles the import skips outright (PLAN §4.2, roadmap 1.7;
 * edited on /admin/roster). Stored one per line; titles are normalized
 * (trimmed, lowercased, de-duplicated) so the import compares them
 * case-insensitively. Saving an empty list stores it and excludes nothing;
 * the hardcoded SKIP_TITLES fixture applies only while the setting was
 * never saved.
 */
export async function setExcludedRosterTitles(raw: string): Promise<SaveExcludedTitlesResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const titles = normalizeTitleList(raw);
  await setSetting(SETTING_EXCLUDED_ROSTER_TITLES, titles.join("\n"));
  revalidatePath("/admin/roster");
  return { ok: true, saved: titles };
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
