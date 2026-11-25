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
import { students, submissions, groups, magicLinks } from "@/lib/db/schema";
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
  testGroupIdFor,
  TEST_GROUP_NAME,
  TEST_GROUP_OPENS_AT,
  TEST_GROUP_CLOSES_AT,
} from "./constants";
import { slugFromName, isValidTestSlug, testEmailFromSlug, isTestAccountEmail } from "./email";
import { workingTermId } from "@/lib/terms/working";
import { assignMembers, groupOf } from "@/lib/groups/membership";
import { enrollMember } from "@/lib/terms/members";
import { ensureCloseRequirements } from "@/lib/closes/requirements";

export type TestAccountError =
  | "forbidden"
  | "invalid-name"
  | "invalid-position"
  | "exists"
  | "not-found"
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
  const termId = await workingTermId();
  const validPositions = await positionOptions(termId);
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

  const testGroupId = await ensureTestGroup(termId);

  try {
    await db.insert(students).values({ email, displayName: name, international, hiredOn });
  } catch {
    fail("exists"); // racing duplicate insert hit the PK
  }
  // Never on the roster: that is what keeps test accounts out of every count.
  await enrollMember(db, termId, email, { positionId, onRoster: false, rosterTitle: null });
  await ensureCloseRequirements(db, termId);
  await assignMembers(db, termId, [email], testGroupId, false);

  revalidatePath("/admin/test-users");
}

/**
 * The term's test-accounts group, created on first use. It is found by its
 * kind, never by its id, because each term has its own. The wide-open bounds
 * are initial values only; admins may edit the window on /admin/groups, so an
 * existing group is left untouched.
 */
async function ensureTestGroup(termId: string): Promise<string> {
  const db = getDb();
  const find = () =>
    db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.termId, termId), eq(groups.kind, "test")))
      .limit(1);
  const [existing] = await find();
  if (existing) return existing.id;
  // Race-safe insert-if-absent on an id fixed per term; a second caller's insert
  // is a no-op.
  await db
    .insert(groups)
    .values({
      id: testGroupIdFor(termId),
      termId,
      name: TEST_GROUP_NAME,
      kind: "test",
      opensAt: TEST_GROUP_OPENS_AT,
      closesAt: TEST_GROUP_CLOSES_AT,
      isDefault: false,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const [created] = await find();
  if (!created) throw new Error("The test-accounts group could not be created.");
  return created.id;
}

/** Whether this account is in the current term's test-accounts group. */
async function isInTestGroup(email: string): Promise<boolean> {
  const group = await groupOf(getDb(), email, await workingTermId());
  return group?.kind === "test";
}

/**
 * Shared gate for every action on an existing account. Requires BOTH
 * test-group membership AND the synthetic domain, so a real student moved
 * into the group via the /admin/groups picker can never be impersonated or
 * deleted. Returns the normalized target email.
 */
async function requireTestAccount(formData: FormData): Promise<string> {
  const gate = await requireAdmin();
  if (!gate.ok) fail("forbidden");
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!(await isInTestGroup(email)) || !isTestAccountEmail(email)) fail("not-found");
  return email;
}

/**
 * Delete a test account in every term. Its shifts cascade away with it, which
 * is fine for a synthetic off-roster account.
 */
export async function deleteTestAccount(formData: FormData): Promise<void> {
  const email = await requireTestAccount(formData);
  const db = getDb();

  // Every term's submission, not just the current one: the student row below
  // cannot be deleted while any submission still points at it.
  const subs = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, email));
  for (const sub of subs) {
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
 * Sign the current admin in AS a test account: mint a single-use magic-link
 * token and redeem it through the existing `magic-link` Credentials provider,
 * no new auth surface. Replaces the admin's session; they return by signing
 * back in with Google.
 */
export async function signInAsTestAccount(formData: FormData): Promise<void> {
  const email = await requireTestAccount(formData);
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
  const email = await requireTestAccount(formData);
  const token = await issueMagicLink(email);
  redirect(`/admin/test-users?token=${encodeURIComponent(token)}&for=${encodeURIComponent(email)}`);
}
