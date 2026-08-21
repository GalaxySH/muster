/**
 * Server-side loaders for the internal availability copy (PLAN.md §10a): the
 * admin-curated working copy the scheduling surfaces read in place of the
 * student's own submission when it exists. Writes live in
 * lib/availability/actions.ts; the pure override rule in effective.ts.
 */
import "server-only";
import { eq, notExists, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/mysql-core";
import { getDb } from "@/lib/db";
import {
  internalAvailability,
  internalSelections,
  shiftSelections,
  submissions,
} from "@/lib/db/schema";
import type { InternalCopy } from "./effective";
import type { SelectedShift } from "@/lib/domain/types";

/**
 * The effective selections as a SQL subquery: the internal copy's cells for
 * submissions that have one, the student's own cells otherwise. Aggregate
 * readers (coverage counts, demand cells, frozen mismatches) select from this
 * instead of shift_selections so what they show matches what the generator
 * schedules. Resolution stays in SQL rather than fanning out per student in JS
 * (the v0.96 lesson); the NOT EXISTS probe is a PK lookup on
 * internal_availability.
 *
 * This resolves which CELLS apply and deliberately not the weekend rotation
 * flag: cells are per (submission, block, day) and the flag is per submission,
 * so carrying it through this union would denormalize it onto every row.
 * `effectiveRotation` in ./effective.ts is the rotation half. Callers that need
 * both take this subquery and that function; callers that need only the flag
 * left-join internal_availability and pass the two columns to it.
 */
export function effectiveSelections() {
  const db = getDb();
  return unionAll(
    db
      .select({
        submissionId: shiftSelections.submissionId,
        shiftBlockId: shiftSelections.shiftBlockId,
        day: shiftSelections.day,
        autoAssigned: shiftSelections.autoAssigned,
      })
      .from(shiftSelections)
      .where(
        notExists(
          db
            .select({ one: sql`1` })
            .from(internalAvailability)
            .where(eq(internalAvailability.submissionId, shiftSelections.submissionId)),
        ),
      ),
    db
      .select({
        submissionId: internalSelections.submissionId,
        shiftBlockId: internalSelections.shiftBlockId,
        day: internalSelections.day,
        autoAssigned: internalSelections.autoAssigned,
      })
      .from(internalSelections),
  ).as("effective_selections");
}

/** The admin per-student view of one internal copy. */
export interface InternalDetail {
  everyWeekendOptIn: boolean;
  editedBy: string;
  editedAt: Date;
  /** The admin's picks. Internal copies are literal: no machine-picked cells. */
  selection: SelectedShift[];
}

/** One submission's internal copy with its audit fields, or null when none exists. */
export async function loadInternalDetail(submissionId: string): Promise<InternalDetail | null> {
  const db = getDb();
  const [header] = await db
    .select()
    .from(internalAvailability)
    .where(eq(internalAvailability.submissionId, submissionId))
    .limit(1);
  if (!header) return null;

  const cells = await db
    .select()
    .from(internalSelections)
    .where(eq(internalSelections.submissionId, submissionId));
  return {
    everyWeekendOptIn: header.everyWeekendOptIn,
    editedBy: header.editedBy,
    editedAt: header.editedAt,
    selection: cells.map((c) => ({ blockId: c.shiftBlockId, day: c.day })),
  };
}

/**
 * Every internal copy keyed by student email, for the generator's override
 * pass. Internal copies are rare (only students an admin adjusted), so this
 * loads them all; the effective merge drops any that don't match an eligible
 * student.
 */
export async function loadInternalCopiesByEmail(): Promise<Map<string, InternalCopy>> {
  const db = getDb();
  const [headers, cells] = await Promise.all([
    db
      .select({
        email: submissions.studentEmail,
        submissionId: internalAvailability.submissionId,
        everyWeekendOptIn: internalAvailability.everyWeekendOptIn,
      })
      .from(internalAvailability)
      .innerJoin(submissions, eq(internalAvailability.submissionId, submissions.id)),
    db
      .select({
        submissionId: internalSelections.submissionId,
        blockId: internalSelections.shiftBlockId,
        day: internalSelections.day,
      })
      .from(internalSelections),
  ]);

  const cellsBySubmission = new Map<string, SelectedShift[]>();
  for (const c of cells) {
    const list = cellsBySubmission.get(c.submissionId) ?? [];
    list.push({ blockId: c.blockId, day: c.day });
    cellsBySubmission.set(c.submissionId, list);
  }
  return new Map(
    headers.map((h) => [
      h.email,
      {
        everyWeekendOptIn: h.everyWeekendOptIn,
        selection: cellsBySubmission.get(h.submissionId) ?? [],
      },
    ]),
  );
}
