"use server";

/**
 * Admin edits to the working semester's own details (the Semester page,
 * docs/semester-domains-plan.md §2.1).
 */
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { terms } from "@/lib/db/schema";
import { requireAdmin, requireAdminIn } from "@/lib/auth/require-admin";
import {
  cleanTermDetails,
  validateNewTerm,
  validateTermDetails,
  type NewTermInput,
  type TermDetails,
} from "@/lib/domain/terms";
import {
  HasResponsesError,
  StartTermError,
  makeTermCurrent,
  startNewTerm,
  type StartTermSummary,
} from "./start-term";
import type { AdminActionResult } from "./actions";

/**
 * Save the working term's name, dates, new hire date, schedule note, system
 * message and the number of closes a new Shift Lead starts on. That number is only a default:
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
    systemMessage: String(input?.systemMessage ?? ""),
    // Not coerced: an unknown color is refused by the check, not saved as blue.
    systemMessageTone: String(input?.systemMessageTone ?? "") as TermDetails["systemMessageTone"],
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
  revalidatePath("/me");
  revalidatePath("/travel");
  revalidatePath("/intro");
  revalidatePath("/exit");
  revalidatePath("/admin/closes");
  return { ok: true };
}

export interface StartSemesterResult extends AdminActionResult {
  /** What the new semester started with, for the confirmation. */
  summary?: StartTermSummary;
}

/**
 * Start a new semester and make it current (docs/semester-domains-plan.md §5
 * Phase 6). `currentTermId` is the semester the page showed as current: the
 * new one copies from it, and the start is refused if that has changed. This
 * always acts on the current semester, whichever one the admin is working in.
 */
export async function startSemester(
  currentTermId: string,
  input: NewTermInput,
): Promise<StartSemesterResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const request: NewTermInput = {
    name: String(input?.name ?? "")
      .trim()
      .replace(/\s+/g, " "),
    startsOn: String(input?.startsOn ?? ""),
    endsOn: String(input?.endsOn ?? ""),
    confirmName: String(input?.confirmName ?? ""),
  };
  const error = validateNewTerm(request);
  if (error) return { ok: false, error };

  try {
    const summary = await startNewTerm(getDb(), {
      name: request.name,
      startsOn: request.startsOn,
      endsOn: request.endsOn,
      createdBy: gate.email,
      fromTermId: String(currentTermId),
    });
    // Every page reads the current semester.
    revalidatePath("/", "layout");
    return { ok: true, summary };
  } catch (e) {
    if (e instanceof StartTermError) return { ok: false, error: e.message };
    console.error("Starting a semester failed:", e);
    return { ok: false, error: "The semester could not be started. Nothing was changed." };
  }
}

export interface MakeCurrentResult extends AdminActionResult {
  /** Set when the semester being left has responses and the admin must confirm. */
  responses?: number;
}

/**
 * Make another semester the current one, to undo a semester started by
 * mistake. Only the pointer moves. Refused when the semester being left has
 * responses, unless `force` is set.
 */
export async function makeSemesterCurrent(
  termId: string,
  currentTermId: string,
  force: boolean,
): Promise<MakeCurrentResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    await makeTermCurrent(getDb(), {
      termId: String(termId),
      fromTermId: String(currentTermId),
      force: force === true,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof HasResponsesError) return { ok: false, responses: e.responses };
    if (e instanceof StartTermError) return { ok: false, error: e.message };
    console.error("Changing the current semester failed:", e);
    return { ok: false, error: "The current semester could not be changed." };
  }
}
