"use server";

/**
 * Admin-gated test-account management (/admin/test-users): the production
 * successor of the dev-only /dev-login manager, for walking the student flow to
 * train admins. Accounts live in a dedicated group (initially wide open;
 * editable on /admin/groups) under a synthetic non-deliverable domain (see
 * ./email), so the ONLY way into one is the admin-minted magic-link token
 * issued by signInAsTestAccount below. All three are form actions: failures
 * surface as ?error=<code> on the manager page.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getDb } from "@/lib/db";
import {
  students,
  submissions,
  groups,
  magicLinks,
  scheduleAssignments,
  scheduleRuns,
} from "@/lib/db/schema";
import { signIn } from "@/lib/auth";
import { MAGIC_LINK_PROVIDER } from "@/lib/auth/config";
import { requireAdmin } from "@/lib/auth/require-admin";
import { issueMagicLink } from "@/lib/auth/magic-link-store";
import { normalizeEmail } from "@/lib/auth/policy";
import { collectSubmissionDriveFileIds } from "@/lib/evidence/data";
import { parseHireDate } from "@/lib/roster/parse";
import { collectChangeRequestDriveFileIds } from "@/lib/changes/data";
import { relayDelete } from "@/lib/drive/relay";
import { positionOptions } from "@/lib/positions/data";
import {
  TEST_GROUP_ID,
  TEST_GROUP_NAME,
  TEST_GROUP_OPENS_AT,
  TEST_GROUP_CLOSES_AT,
} from "./constants";
import { slugFromName, isValidTestSlug, testEmailFromSlug, isTestAccountEmail } from "./email";

export type TestAccountError =
  | "forbidden"
  | "invalid-name"
  | "invalid-position"
  | "exists"
  | "not-found"
  | "in-schedule"
  | "signin";

function fail(code: TestAccountError): never {
  redirect(`/admin/test-users?error=${code}`);
}

export async function createTestAccount(formData: FormData): Promise<void> {
  const gate = await requireAdmin();
  if (!gate.ok) fail("forbidden");

  const name = String(formData.get("name") ?? "").trim();
  const slug = slugFromName(name);
  if (!isValidTestSlug(slug)) fail("invalid-name");
  const positionId = String(formData.get("position") ?? "");
  const validPositions = await positionOptions();
  if (!validPositions.some((p) => p.id === positionId)) fail("invalid-position");
  const international = formData.get("international") === "on";
  // Same tolerance as the roster importer: blank or unparseable means no hire
  // date, useful for testing the workbook-omitted case alongside returners.
  const hiredOn = parseHireDate(String(formData.get("hiredOn") ?? ""));
  const email = testEmailFromSlug(slug);

  const db = getDb();
  // Refuse (never upsert) when any row already exists; an upsert here could
  // hijack an existing student row into the test group.
  const [existing] = await db
    .select({ email: students.email })
    .from(students)
    .where(eq(students.email, email))
    .limit(1);
  if (existing) fail("exists");

  // Ensure the test group exists (race-safe insert-if-absent). The wide-open
  // bounds are initial values only; admins may edit the window on
  // /admin/groups, so an existing row is left untouched (`id = id` no-op).
  await db
    .insert(groups)
    .values({
      id: TEST_GROUP_ID,
      name: TEST_GROUP_NAME,
      opensAt: TEST_GROUP_OPENS_AT,
      closesAt: TEST_GROUP_CLOSES_AT,
      isDefault: false,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

  try {
    await db.insert(students).values({
      email,
      displayName: name,
      positionId,
      international,
      hiredOn,
      onRoster: false,
      groupId: TEST_GROUP_ID,
      groupAssignedAuto: false,
    });
  } catch {
    fail("exists"); // racing duplicate insert hit the PK
  }

  revalidatePath("/admin/test-users");
}

export async function deleteTestAccount(formData: FormData): Promise<void> {
  const gate = await requireAdmin();
  if (!gate.ok) fail("forbidden");
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  const db = getDb();
  const [stu] = await db
    .select({ groupId: students.groupId })
    .from(students)
    .where(eq(students.email, email))
    .limit(1);

  // Safety rail: only ever delete accounts the manager owns (in the test group),
  // never a real roster student. Group-only (not domain) so legacy dev-created
  // @wisc.edu accounts stay deletable.
  if (!stu || stu.groupId !== TEST_GROUP_ID) fail("not-found");

  // schedule_assignments cascades off students, so deleting the account would
  // strip its shifts out of the schedule with no warning. Nothing keeps a test
  // account off it: the per-student grid applies no on-roster check
  // (schedule/manual.ts), so an admin can hand-place one. Refused rather than
  // reported, the same way a position with run rows on its blocks is
  // (positions/actions.ts), and checked before anything else is deleted so a
  // refusal costs no rows and no Drive files.
  //
  // Scoped to the current run on purpose. Superseded runs can also hold rows for
  // this account, but the grid only edits the current one, so guarding on those
  // would leave the account permanently undeletable with no way to clear it. The
  // run the scheduler is working from is the one worth protecting; older runs
  // lose a synthetic row from their history, which is what a test account is.
  const [assigned] = await db
    .select({ runId: scheduleAssignments.runId })
    .from(scheduleAssignments)
    .innerJoin(scheduleRuns, eq(scheduleAssignments.runId, scheduleRuns.id))
    .where(and(eq(scheduleAssignments.studentEmail, email), eq(scheduleRuns.status, "current")))
    .limit(1);
  if (assigned) fail("in-schedule");

  const [sub] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);
  if (sub) {
    // Gather Drive proof fileIds before the cascade removes their rows, then
    // best-effort delete each from Drive (relayDelete never throws; it no-ops
    // without a grant, so local dev keeps working).
    const fileIds = await collectSubmissionDriveFileIds(sub.id);
    await db.delete(submissions).where(eq(submissions.id, sub.id)); // cascades selections/flags/etc.
    for (const fileId of fileIds) await relayDelete(fileId);
  }
  await db.delete(magicLinks).where(eq(magicLinks.studentEmail, email)); // no FK; sign-in-as mints these
  // Change-request proofs hang off the student (not the submission): gather
  // before the student delete cascades their rows away, then best-effort delete.
  const changeProofIds = await collectChangeRequestDriveFileIds(email);
  await db.delete(students).where(eq(students.email, email));
  for (const fileId of changeProofIds) await relayDelete(fileId);
  // No sheet resync: test accounts are off-roster and never in the sheet/export.

  revalidatePath("/admin/test-users");
}

/**
 * Shared gate for the two impersonation actions below. Requires BOTH
 * test-group membership AND the synthetic domain, so a real student moved
 * into the group via the /admin/groups picker can never be impersonated.
 * Returns the normalized target email.
 */
async function requireImpersonableTestAccount(formData: FormData): Promise<string> {
  const gate = await requireAdmin();
  if (!gate.ok) fail("forbidden");
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  const db = getDb();
  const [stu] = await db
    .select({ groupId: students.groupId })
    .from(students)
    .where(eq(students.email, email))
    .limit(1);
  if (!stu || stu.groupId !== TEST_GROUP_ID || !isTestAccountEmail(email)) fail("not-found");
  return email;
}

/**
 * Sign the current admin in AS a test account: mint a single-use magic-link
 * token and redeem it through the existing `magic-link` Credentials provider,
 * no new auth surface. Replaces the admin's session; they return by signing
 * back in with Google.
 */
export async function signInAsTestAccount(formData: FormData): Promise<void> {
  const email = await requireImpersonableTestAccount(formData);
  const token = await issueMagicLink(email);
  try {
    await signIn(MAGIC_LINK_PROVIDER, { token, email, redirectTo: "/me" });
  } catch (error) {
    if (error instanceof AuthError) fail("signin");
    // Otherwise it's the success NEXT_REDIRECT thrown by signIn; let it through.
    throw error;
  }
}

/**
 * Mint a magic link for a test account WITHOUT redeeming it, so the admin can
 * open it in a private window and keep their own session. Redirects back to
 * the manager with the raw token; the page assembles the /magic/redeem URL
 * (never a caller-supplied one) and shows it with a copy button. Same
 * single-use expiring token as sign-in-as.
 */
export async function mintTestAccountLink(formData: FormData): Promise<void> {
  const email = await requireImpersonableTestAccount(formData);
  const token = await issueMagicLink(email);
  redirect(
    `/admin/test-users?token=${encodeURIComponent(token)}&for=${encodeURIComponent(email)}`,
  );
}
