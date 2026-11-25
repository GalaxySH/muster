/**
 * Tiny key/value accessor over the `app_settings` table (PLAN.md §13): runtime
 * state (the Drive proofs-folder id, the running responses-sheet id, the last
 * sheet-sync timestamp) and admin-set app config (default-group auto-assign,
 * the travel cutoff, the excluded roster titles).
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import {
  defaultTravelCutoff,
  LATE_TRAVEL_POLICY,
  type LateTravelPolicy,
} from "@/lib/domain/travel";
import { parseSchedulingParams, type SchedulingParams } from "@/lib/domain/scheduling/params";
import { parseScheduleEmailConfig, type ScheduleEmailConfig } from "@/lib/email/schedule-email";
import { workingTermId } from "@/lib/terms/working";
import { getTerm } from "@/lib/terms/term-id";
import { termSettingKey } from "@/lib/domain/terms";
import { loadRosterConfig, type EffectiveRosterConfig } from "@/lib/roster/config-data";

/**
 * The Drive keys below are per term: read and write them through
 * `termSettingKey(base, termId)`.
 */
export const SETTING_PROOFS_FOLDER_ID = "proofs_folder_id";
/** The cached id of a term's own Drive folder. Per term, like the keys beside it. */
export const SETTING_TERM_FOLDER_ID = "term_folder_id";
/**
 * The id of the one term whose files live at the Drive root instead of in a
 * folder of their own: the term that existed before terms had folders.
 */
export const SETTING_DRIVE_ROOT_TERM = "drive_root_term";
export const SETTING_RESPONSES_SHEET_ID = "responses_sheet_id";
export const SETTING_RESPONSES_SHEET_SYNCED_AT = "responses_sheet_synced_at";
export const SETTING_CLOSES_SHEET_ID = "closes_sheet_id";
export const SETTING_CLOSES_SHEET_SYNCED_AT = "closes_sheet_synced_at";
export const SETTING_SCHEDULE_SHEET_ID = "schedule_sheet_id";
export const SETTING_SCHEDULE_SHEET_SYNCED_AT = "schedule_sheet_synced_at";
/** "1"/"0": whether ungrouped students get swept into the default group (PLAN §13). Absent ⇒ off. */
export const SETTING_DEFAULT_GROUP_AUTO_ASSIGN = "default_group_auto_assign";
/** "1"/"0": master switch for outbound email. Absent ⇒ enabled (the default). */
export const SETTING_EMAIL_SENDING_ENABLED = "email_sending_enabled";
/** "1"/"0": the daily schedule-change digest (roadmap 3.1). Absent ⇒ enabled. */
export const SETTING_CHANGE_DIGEST_ENABLED = "change_digest_enabled";
/** Comma-separated digest recipient emails, admin-set. Absent ⇒ none (nothing sends). */
export const SETTING_CHANGE_DIGEST_RECIPIENTS = "change_digest_recipients";
/**
 * ISO instant of the last digest run, stamped on EVERY run including the ones
 * that send nothing. Without it a dead scheduler is indistinguishable from a
 * quiet week, so the admin surfaces could never tell the difference (roadmap
 * 4.1). Also the compare-and-set target the scheduler claims runs through.
 */
export const SETTING_CHANGE_DIGEST_LAST_RUN = "change_digest_last_run";
/**
 * ISO instant of the last Drive write that succeeded. Only a refresh token is
 * persisted (no expiry), and the only true probe uploads a live file, so this
 * is what lets the hub report Drive health without a network call (roadmap 4.1).
 */
export const SETTING_DRIVE_LAST_OK_AT = "drive_last_ok_at";
/**
 * ISO instant of the last Drive write that FAILED (token refresh, upload, or
 * sheet write threw). Paired with drive_last_ok_at: a failure newer than the
 * last success means Drive is currently down, usually a revoked grant, which
 * the row-existence "connected" check cannot see on its own (roadmap 4.1).
 */
export const SETTING_DRIVE_LAST_ERROR_AT = "drive_last_error_at";
/** JSON SchedulingParams for the schedule engine, admin-set on /admin/schedule. Absent ⇒ defaults. */
export const SETTING_SCHEDULE_PARAMS = "schedule_params";
/** "1"/"0": whether the student-facing change-request form is offered (roadmap 3.1). Absent ⇒ on. */
export const SETTING_CHANGE_REQUESTS_ENABLED = "change_requests_enabled";
/** "1"/"0": whether students see the high-demand marks on their grid (roadmap 2.5). Absent ⇒ shown. */
export const SETTING_HIGH_DEMAND_MARKS = "high_demand_marks";
/** JSON ScheduleEmailConfig for the "schedule is posted" email. Absent ⇒ the default template. */
export const SETTING_SCHEDULE_EMAIL = "schedule_email";

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb().insert(appSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
}

export async function deleteSetting(key: string): Promise<void> {
  await getDb().delete(appSettings).where(eq(appSettings.key, key));
}

/**
 * The term's travel-excusal cutoff (PLAN §8). `isCustom` says whether the admin
 * moved it off the term's default, the day before the term starts.
 */
export async function getTravelCutoff(
  termId: string,
): Promise<{ cutoff: Date; isCustom: boolean }> {
  const term = await getTerm(getDb(), termId);
  return {
    cutoff: term.travelCutoff,
    isCustom: term.travelCutoff.getTime() !== defaultTravelCutoff(term.startsOn).getTime(),
  };
}

/**
 * The term's late-travel policy (PLAN §8), admin-toggled on /admin/terms.
 * Off (the default) keeps the domain's "refuse" policy: nothing past the cutoff
 * is stored. On, entries past the cutoff are accepted but stored unexcused
 * ("accept-and-flag"), and finalize raises the travel_late flag.
 */
export async function getLateTravelPolicy(termId: string): Promise<LateTravelPolicy> {
  return (await getTerm(getDb(), termId)).lateTravelAccept ? "accept-and-flag" : LATE_TRAVEL_POLICY;
}

/**
 * The master email switch (admin-set). Enabled by default; only an explicit "0"
 * turns it off. When off, no outbound email is sent (sign-in links or batch
 * notifications) — the choke point is `sendEmail` in `email/resend.ts`.
 */
export async function getEmailSendingEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_EMAIL_SENDING_ENABLED)) !== "0";
}

/**
 * The daily schedule-change digest switch (roadmap 3.1, admin-set on
 * /admin/email-settings). Enabled by default, but the digest only actually
 * sends when recipients are configured too (and the master switch is on).
 */
export async function getChangeDigestEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_CHANGE_DIGEST_ENABLED)) !== "0";
}

/**
 * The digest recipient list (roadmap 3.1): admin-configured in app_settings,
 * NOT the ADMIN_EMAILS env allowlist and not the roster-imported admins.
 * Empty until an admin sets it, which keeps the digest silent.
 */
export async function getChangeDigestRecipients(): Promise<string[]> {
  const raw = await getSetting(SETTING_CHANGE_DIGEST_RECIPIENTS);
  return raw ? raw.split(",").filter(Boolean) : [];
}

/**
 * How the current term's roster tracker is read (PLAN §4.2): the sheets, the
 * column names, the titles that mean admin, and the titles skipped outright
 * (neither student nor admin; they fall back to the SKIP_TITLES fixture until
 * first saved). Admin-edited on /admin/roster and stored on the term. The
 * reader lives in roster/config-data.ts so the CLI-safe importer can use it
 * without this server-only module.
 */
export async function getRosterConfig(): Promise<EffectiveRosterConfig> {
  return loadRosterConfig(getDb(), await workingTermId());
}

/**
 * The schedule engine's tunable knobs (docs/schedule-generation-plan.md §3.2),
 * admin-set on /admin/schedule; the domain defaults apply until first saved
 * (and whenever the stored value is unreadable). They are stored per term
 * because they name positions (the coverage pool), and each term has its own.
 */
export async function getSchedulingParams(termId: string): Promise<SchedulingParams> {
  return parseSchedulingParams(await getSetting(termSettingKey(SETTING_SCHEDULE_PARAMS, termId)));
}

/**
 * Whether the student-facing change-request form is offered (admin-set on
 * /admin/change-requests). On by default; off hides the /me card and swaps the
 * /intro copy to point at email instead. The `/change-requests` route itself
 * and the admin queue stay reachable either way.
 */
export async function getChangeRequestsEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_CHANGE_REQUESTS_ENABLED)) !== "0";
}

/**
 * Whether the student availability grid marks its busiest shifts (the red bar,
 * roadmap 2.5), admin-toggled on /admin/groups. On by default. Off drops the
 * marks and their legend from the student form only: the admin grids keep
 * showing the same cells, since the signal is scheduler context either way.
 */
export async function getHighDemandMarksEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_HIGH_DEMAND_MARKS)) !== "0";
}

/**
 * The "schedule is posted" email's template, cc, sender, and whether a send
 * marks the student scheduled (admin-set on /admin/email-settings). The default
 * applies field by field until saved.
 */
export async function getScheduleEmailConfig(): Promise<ScheduleEmailConfig> {
  return parseScheduleEmailConfig(await getSetting(SETTING_SCHEDULE_EMAIL));
}

/** Parse a stored ISO instant, treating an unparseable value as absent. */
async function getInstant(key: string): Promise<Date | null> {
  const raw = await getSetting(key);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getChangeDigestLastRun(): Promise<Date | null> {
  return getInstant(SETTING_CHANGE_DIGEST_LAST_RUN);
}

/** Record that the digest ran, whether or not it had anything to send. */
export async function markChangeDigestRun(now: Date = new Date()): Promise<void> {
  await setSetting(SETTING_CHANGE_DIGEST_LAST_RUN, now.toISOString());
}

/**
 * Atomically claim the digest run for `now`: flips change_digest_last_run
 * from the exact value the caller read to `now`. Returns false when another
 * process got there first (the stored value no longer matches), which is what
 * keeps two scheduler ticks from double-sending. ISO strings round-trip
 * through Date exactly, so comparing the re-serialized read is safe.
 */
export async function claimChangeDigestRun(expected: Date | null, now: Date): Promise<boolean> {
  const db = getDb();
  if (expected === null) {
    // First run ever: insert-if-absent. The no-op duplicate update reports 0
    // affected rows, so a lost race reads as an unclaimed run.
    const res = await db
      .insert(appSettings)
      .values({ key: SETTING_CHANGE_DIGEST_LAST_RUN, value: now.toISOString() })
      .onDuplicateKeyUpdate({ set: { key: sql`${appSettings.key}` } });
    return res[0].affectedRows === 1;
  }
  const res = await db
    .update(appSettings)
    .set({ value: now.toISOString() })
    .where(
      and(
        eq(appSettings.key, SETTING_CHANGE_DIGEST_LAST_RUN),
        eq(appSettings.value, expected.toISOString()),
      ),
    );
  return res[0].affectedRows > 0;
}

export async function getDriveLastOkAt(): Promise<Date | null> {
  return getInstant(SETTING_DRIVE_LAST_OK_AT);
}

/** Record a Drive write that came back clean. Best effort: never fails a relay. */
export async function markDriveOk(now: Date = new Date()): Promise<void> {
  try {
    await setSetting(SETTING_DRIVE_LAST_OK_AT, now.toISOString());
  } catch (e) {
    console.error("Could not record the Drive health stamp (non-fatal):", e);
  }
}

export async function getDriveLastError(): Promise<Date | null> {
  return getInstant(SETTING_DRIVE_LAST_ERROR_AT);
}

/** Record a Drive write that threw. Best effort: never masks the original error. */
export async function markDriveFailed(now: Date = new Date()): Promise<void> {
  try {
    await setSetting(SETTING_DRIVE_LAST_ERROR_AT, now.toISOString());
  } catch (e) {
    console.error("Could not record the Drive failure stamp (non-fatal):", e);
  }
}
