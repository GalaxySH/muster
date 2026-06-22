"use server";

/**
 * Dev-only test-account management for the /dev-login manager. Every action is a
 * no-op unless DEV_LOGIN_ENABLED is set, so it can never mutate data in prod.
 * Accounts live in a dedicated always-open dev group (see constants) — that's how
 * `delete` knows it's only ever removing accounts the manager created.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, submissions, groups, magicLinks } from "@/lib/db/schema";
import { devLoginEnabled } from "@/lib/env";
import { normalizeEmail, isWiscEmail } from "@/lib/auth/policy";
import { POSITIONS } from "@/lib/config/positions";
import {
  DEV_GROUP_ID,
  DEV_GROUP_NAME,
  DEV_GROUP_OPENS_AT,
  DEV_GROUP_CLOSES_AT,
} from "./constants";

export async function createDevStudent(formData: FormData): Promise<void> {
  if (!devLoginEnabled) return;

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!isWiscEmail(email)) return;
  const positionId = String(formData.get("position") ?? "");
  if (!POSITIONS.some((p) => p.id === positionId)) return;
  const name = String(formData.get("name") ?? "").trim() || email.split("@")[0] || email;
  const international = formData.get("international") === "on";

  const db = getDb();
  // Ensure the always-open dev group exists, then drop the student into it.
  await db
    .insert(groups)
    .values({
      id: DEV_GROUP_ID,
      name: DEV_GROUP_NAME,
      opensAt: DEV_GROUP_OPENS_AT,
      closesAt: DEV_GROUP_CLOSES_AT,
      isDefault: false,
    })
    .onDuplicateKeyUpdate({
      set: { opensAt: DEV_GROUP_OPENS_AT, closesAt: DEV_GROUP_CLOSES_AT },
    });

  await db
    .insert(students)
    .values({
      email,
      displayName: name,
      positionId,
      international,
      onRoster: false,
      groupId: DEV_GROUP_ID,
      groupAssignedAuto: false,
    })
    .onDuplicateKeyUpdate({
      set: { displayName: name, positionId, international, groupId: DEV_GROUP_ID },
    });

  revalidatePath("/dev-login");
}

export async function deleteDevStudent(formData: FormData): Promise<void> {
  if (!devLoginEnabled) return;
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  const db = getDb();
  const [stu] = await db
    .select({ groupId: students.groupId })
    .from(students)
    .where(eq(students.email, email))
    .limit(1);

  // Safety rail: only ever delete accounts the manager owns (in the dev group),
  // never a real roster student who happens to be typed in.
  if (!stu || stu.groupId !== DEV_GROUP_ID) return;

  const [sub] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);
  if (sub) await db.delete(submissions).where(eq(submissions.id, sub.id)); // cascades selections/flags/etc.
  await db.delete(magicLinks).where(eq(magicLinks.studentEmail, email));
  await db.delete(students).where(eq(students.email, email));

  revalidatePath("/dev-login");
}
