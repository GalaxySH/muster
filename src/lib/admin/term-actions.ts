"use server";

/**
 * Admin edits to the working semester's own details (the Semester page,
 * docs/semester-domains-plan.md §2.1).
 */
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { requireAdminIn } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { terms } from "@/lib/db/schema";
import { cleanTermDetails, validateTermDetails, type TermDetails } from "@/lib/domain/terms";
import type { AdminActionResult } from "./actions";

/**
 * Save the working term's name, dates, new hire date, schedule note and the
 * number of closes a new Shift Lead starts on. That number is only a default:
 * leads who already have one keep it (lib/closes/requirements.ts).
 */
export async function saveTermDetails(
  termId: string,
  input: TermDetails,
): Promise<AdminActionResult> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const details = cleanTermDetails({
    name: String(input?.name ?? ""),
    startsOn: String(input?.startsOn ?? ""),
    endsOn: String(input?.endsOn ?? ""),
    newHireCutoff: String(input?.newHireCutoff ?? ""),
    scheduleNote: String(input?.scheduleNote ?? ""),
    closeRequirement: Number(input?.closeRequirement),
  });
  const error = validateTermDetails(details);
  if (error) return { ok: false, error };

  const db = getDb();
  const [taken] = await db
    .select({ id: terms.id })
    .from(terms)
    .where(and(eq(terms.name, details.name), ne(terms.id, termId)))
    .limit(1);
  if (taken) return { ok: false, error: "Another semester already has that name." };

  // The travel cutoff is not touched: it stays where the admin set it, even
  // when the first day moves. It is edited in its own panel on the same page.
  await db.update(terms).set(details).where(eq(terms.id, termId));

  // The name is in every admin header; the dates and note reach these pages.
  revalidatePath("/admin", "layout");
  revalidatePath("/travel");
  revalidatePath("/intro");
  revalidatePath("/exit");
  revalidatePath("/admin/closes");
  return { ok: true };
}
