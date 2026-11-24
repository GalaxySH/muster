"use server";

/**
 * Admin edits to the current term's own details (the Semester page,
 * docs/semester-domains-plan.md §2.1). Like every write, this resolves the
 * current term itself and takes no term id from the client, so an earlier term
 * can't be edited from any screen.
 */
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { terms } from "@/lib/db/schema";
import { cleanTermDetails, validateTermDetails, type TermDetails } from "@/lib/domain/terms";
import { currentTerm } from "@/lib/terms/current";
import type { AdminActionResult } from "./actions";

/** Save the current term's name, dates, new hire date and schedule note. */
export async function saveTermDetails(input: TermDetails): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const details = cleanTermDetails({
    name: String(input?.name ?? ""),
    startsOn: String(input?.startsOn ?? ""),
    endsOn: String(input?.endsOn ?? ""),
    newHireCutoff: String(input?.newHireCutoff ?? ""),
    scheduleNote: String(input?.scheduleNote ?? ""),
  });
  const error = validateTermDetails(details);
  if (error) return { ok: false, error };

  const db = getDb();
  const term = await currentTerm();
  const [taken] = await db
    .select({ id: terms.id })
    .from(terms)
    .where(and(eq(terms.name, details.name), ne(terms.id, term.id)))
    .limit(1);
  if (taken) return { ok: false, error: "Another semester already has that name." };

  // The travel cutoff is not touched: it stays where the admin set it, even
  // when the first day moves. It is edited in its own panel on the same page.
  await db.update(terms).set(details).where(eq(terms.id, term.id));

  // The name is in every admin header; the dates and note reach these pages.
  revalidatePath("/admin", "layout");
  revalidatePath("/travel");
  revalidatePath("/intro");
  revalidatePath("/exit");
  return { ok: true };
}
