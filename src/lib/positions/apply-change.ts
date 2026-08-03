/**
 * Shared position-change routine (roadmap 3.3).
 *
 * When a student who has a submission changes position (a PCPL promotion, an
 * alias switch, or a ghost resolution), the caller runs `applyPositionChange`
 * inside its transaction: the pure carry-over re-points time-identical
 * selections to the new position's blocks and drops the rest, a
 * `position_change` flag records what happened, and the generic
 * `syncRevalidationFlag` seam re-runs validateAvailability against the new
 * block set, owning the single `revalidation_failed` flag.
 *
 * A move into a ghost title (no target position) or into a position with no
 * blocks DEFERS the carry-over: selection rows stay untouched and the routine
 * runs again when the ghost resolves. Because of that, the carry-over reads
 * its source blocks from the rows themselves (not from `fromPositionId`),
 * so a deferred move's stale rows still match on their real times later.
 *
 * Plain server-side module (no `server-only` import): the roster importer
 * calls it from the CLI as well as from the admin upload action.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  flags,
  internalSelections,
  positions,
  shiftBlocks,
  shiftSelections,
  students,
  submissions,
} from "@/lib/db/schema";
import { toDomainBlock, toDomainPosition } from "@/lib/db/mappers";
import { carryOverSelections } from "@/lib/domain/carry-over";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";

/** A drizzle transaction handle; both seams run inside the caller's transaction. */
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PositionChangeInput {
  email: string;
  fromPositionId: string | null;
  toPositionId: string | null;
}

export interface PositionChangeResult {
  /** False when the student has no submission: nothing to migrate or flag. */
  hadSubmission: boolean;
  /** Selection rows re-pointed to a time-identical target block. */
  carriedOver: number;
  /** Selection rows deleted (no time-identical target block). */
  dropped: number;
  /** True when the carry-over was deferred: no target position, or no blocks yet. */
  deferred: boolean;
  /** True when the post-change revalidation failed (skipped while deferred). */
  revalidationFailed: boolean;
}

const NO_SUBMISSION: PositionChangeResult = {
  hadSubmission: false,
  carriedOver: 0,
  dropped: 0,
  deferred: false,
  revalidationFailed: false,
};

/**
 * Apply a position change to a student's submission: carry selections over,
 * write the `position_change` flag (replacing any earlier one), and re-run
 * validation. No-op for students without a submission.
 */
export async function applyPositionChange(
  tx: DbTx,
  input: PositionChangeInput,
): Promise<PositionChangeResult> {
  const [sub] = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, input.email))
    .limit(1);
  if (!sub) return NO_SUBMISSION;

  const targetBlocks = input.toPositionId
    ? (
        await tx.select().from(shiftBlocks).where(eq(shiftBlocks.positionId, input.toPositionId))
      ).map(toDomainBlock)
    : [];
  const deferred = targetBlocks.length === 0;

  let carriedOver = 0;
  let dropped = 0;
  if (!deferred) {
    const remap = async (table: typeof shiftSelections | typeof internalSelections) => {
      const rows = await tx
        .select({ blockId: table.shiftBlockId, day: table.day, autoAssigned: table.autoAssigned })
        .from(table)
        .where(eq(table.submissionId, sub.id));
      if (rows.length === 0) return { kept: 0, dropped: 0 };
      // Source blocks are the blocks the rows actually reference (see header).
      const referencedIds = [...new Set(rows.map((r) => r.blockId))];
      const sourceBlocks = (
        await tx.select().from(shiftBlocks).where(inArray(shiftBlocks.id, referencedIds))
      ).map(toDomainBlock);
      const result = carryOverSelections(rows, sourceBlocks, targetBlocks);
      // Delete + insert; kept rows are already deduped against the composite
      // PK (submissionId, shiftBlockId, day) by carryOverSelections.
      await tx.delete(table).where(eq(table.submissionId, sub.id));
      if (result.kept.length > 0) {
        await tx.insert(table).values(
          result.kept.map((r) => ({
            submissionId: sub.id,
            shiftBlockId: r.blockId,
            day: r.day,
            autoAssigned: r.autoAssigned,
          })),
        );
      }
      return { kept: result.kept.length, dropped: result.dropped.length };
    };
    const studentRows = await remap(shiftSelections);
    carriedOver = studentRows.kept;
    dropped = studentRows.dropped;
    // The admin's internal copy (PLAN §10a) follows the same carry-over, so
    // its cells never point at another position's blocks (the engine silently
    // drops out-of-position cells). The flag detail reports the student's own
    // rows; the internal copy is scheduler working state.
    await remap(internalSelections);
  }

  const detail = await changeDetail(tx, input, { deferred, carriedOver, dropped });
  // Replace any earlier position_change flag instead of stacking a second one.
  await tx
    .delete(flags)
    .where(and(eq(flags.submissionId, sub.id), eq(flags.type, "position_change")));
  await tx
    .insert(flags)
    .values({ id: randomUUID(), submissionId: sub.id, type: "position_change", detail });

  // While deferred there is no block set to validate against; the flag from a
  // previous run (if any) stays until the ghost resolves and this reruns.
  const revalidationFailed = deferred ? false : await syncRevalidationFlag(tx, sub.id);

  return { hadSubmission: true, carriedOver, dropped, deferred, revalidationFailed };
}

/** Human copy for the position_change flag detail. */
async function changeDetail(
  tx: DbTx,
  input: PositionChangeInput,
  outcome: { deferred: boolean; carriedOver: number; dropped: number },
): Promise<string> {
  const ids = [input.fromPositionId, input.toPositionId].filter((v): v is string => v !== null);
  const nameRows =
    ids.length > 0
      ? await tx
          .select({ id: positions.id, name: positions.name })
          .from(positions)
          .where(inArray(positions.id, ids))
      : [];
  const nameOf = (id: string | null) =>
    id === null ? null : (nameRows.find((r) => r.id === id)?.name ?? id);
  const fromName = nameOf(input.fromPositionId);
  const toName = nameOf(input.toPositionId);

  const head =
    fromName && toName
      ? `Position changed from ${fromName} to ${toName}.`
      : fromName
        ? `Position changed from ${fromName}.`
        : `Position set to ${toName}.`;
  const tail = !outcome.deferred
    ? `${outcome.carriedOver} shift pick${outcome.carriedOver === 1 ? "" : "s"} kept, ${outcome.dropped} dropped.`
    : toName
      ? `${toName} has no shifts set up yet, so shift picks are unchanged.`
      : `The new title has no position yet, so shift picks are unchanged.`;
  return `${head} ${tail}`;
}

/**
 * Generic revalidation seam: re-run the same checks the wizard's submit gate
 * runs (validateAvailability hard rules plus checkDesiredHours, on the
 * student's own picks with auto-assigned and out-of-position rows excluded)
 * and sync the single `revalidation_failed` flag: written with the failing
 * rule messages when validation fails, deleted the moment a run passes or the
 * student has no position. Drafts revalidate the same way as submitted forms.
 * Returns true when validation failed.
 */
export async function syncRevalidationFlag(tx: DbTx, submissionId: string): Promise<boolean> {
  const clear = async () => {
    await tx
      .delete(flags)
      .where(and(eq(flags.submissionId, submissionId), eq(flags.type, "revalidation_failed")));
    return false;
  };

  const [row] = await tx
    .select({
      everyWeekendOptIn: submissions.everyWeekendOptIn,
      desiredHours: submissions.desiredHours,
      positionId: students.positionId,
    })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!row?.positionId) return clear();

  const [posRow] = await tx
    .select()
    .from(positions)
    .where(eq(positions.id, row.positionId))
    .limit(1);
  if (!posRow) return clear();
  const position = toDomainPosition(posRow);
  const blocks = (
    await tx.select().from(shiftBlocks).where(eq(shiftBlocks.positionId, position.id))
  ).map(toDomainBlock);

  const validIds = new Set(blocks.map((b) => b.id));
  const selRows = await tx
    .select({ blockId: shiftSelections.shiftBlockId, day: shiftSelections.day })
    .from(shiftSelections)
    .where(
      and(eq(shiftSelections.submissionId, submissionId), eq(shiftSelections.autoAssigned, false)),
    );
  const selection = selRows.filter((s) => validIds.has(s.blockId));

  const result = validateAvailability(selection, position, blocks, {
    everyWeekendOptIn: row.everyWeekendOptIn,
  });
  const failures = result.checks
    .filter((c) => c.severity === "hard" && !c.passed)
    .map((c) => c.detail);
  const desired = checkDesiredHours(row.desiredHours, position);
  if (!desired.passed) failures.push(desired.detail);
  if (failures.length === 0) return clear();

  // Keep exactly one flag with fresh detail: replace rather than accumulate.
  await tx
    .delete(flags)
    .where(and(eq(flags.submissionId, submissionId), eq(flags.type, "revalidation_failed")));
  await tx.insert(flags).values({
    id: randomUUID(),
    submissionId,
    type: "revalidation_failed",
    detail: `Availability no longer passes checks: ${failures.join("; ")}.`,
  });
  return true;
}
