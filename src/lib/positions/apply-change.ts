/**
 * Shared position-change routine (roadmap 3.3).
 *
 * When a student changes position (a PCPL promotion, an admin edit, an alias
 * switch, or a ghost resolution), the caller runs `applyPositionChange` inside
 * its transaction. It does four things:
 *
 * 1. Writes a `position_changes` row. That table is the permanent record and it
 *    accumulates, so a student who moves twice has both moves. The
 *    `position_change` flag beside it is the transient "look at this" marker,
 *    replaced on each change and dismissable.
 * 2. Removes the student's shifts from the CURRENT run. Shifts never transfer
 *    between positions, and a shift left on the old position's block is worse
 *    than no shift: it counts in every hours total and draws in no grid.
 * 3. Carries picks over where the new position has a time-identical block, and
 *    LEAVES THE REST WHERE THEY ARE rather than deleting them. A pick with no
 *    counterpart becomes an orphan on the old block, which is what makes it
 *    visible to the admin as a read-only row they can clear. A student's answer
 *    is never silently thrown away because their position moved under them.
 * 4. Re-runs the checks through the generic `syncRevalidationFlag` seam, which
 *    owns the single `revalidation_failed` flag, and re-syncs the orphan flag.
 *
 * Steps 1 and 2 run for every student; only 3 and 4 need a submission. Position
 * and schedule rows hang off the email, not off a submission.
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
import { and, eq, inArray, or } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  flags,
  internalAvailability,
  internalSelections,
  positionChanges,
  positions,
  scheduleAssignments,
  scheduleRuns,
  shiftBlocks,
  shiftSelections,
  students,
  submissions,
  type PositionChangeSource,
} from "@/lib/db/schema";
import { isLiveBlock, liveBlocksOnly } from "@/lib/db/blocks";
import { toDomainBlock, toDomainPosition } from "@/lib/db/mappers";
import { effectiveRotation } from "@/lib/availability/effective";
import { carryOverSelections } from "@/lib/domain/carry-over";
import { partitionSelection } from "@/lib/domain/orphans";
import { checkDesiredHours, validateAvailability } from "@/lib/domain/validation";
import { syncOrphanedSelectionFlag } from "./orphans";

/** A drizzle transaction handle; both seams run inside the caller's transaction. */
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PositionChangeInput {
  email: string;
  fromPositionId: string | null;
  toPositionId: string | null;
  /** What moved it, stored on the history row. */
  source: PositionChangeSource;
  /** The admin who did it; null for a roster import, which has no actor. */
  changedBy?: string | null;
}

export interface PositionChangeResult {
  /** False when the student has no submission: no picks to migrate, no flags. */
  hadSubmission: boolean;
  /** Selection rows re-pointed to a time-identical target block. */
  carriedOver: number;
  /**
   * Selection rows with no counterpart in the new position, LEFT WHERE THEY
   * ARE. They read as orphans from here on: dead to every calculation, visible
   * to the admin, clearable only by the admin.
   */
  preserved: number;
  /** Current-run shifts removed, because they were on the old position. */
  removedShifts: number;
  /** True when the carry-over was deferred: no target position, or no blocks yet. */
  deferred: boolean;
  /** True when the post-change revalidation failed (skipped while deferred). */
  revalidationFailed: boolean;
}

/**
 * Apply a position change to a student: record it, strip the shifts it
 * invalidates, carry what selections still fit, and re-run the checks.
 *
 * The first two steps run for EVERY student, submission or not. A position and
 * a schedule row both hang off the email, not off a submission, so gating them
 * on one loses exactly the case that hurts: a student with shifts in the
 * current run and no submission keeps those shifts on their old position's
 * blocks, where every hours reader counts them (the join is on block id) and no
 * grid can draw them (a grid renders the POSITION's blocks). That is a person
 * showing eleven scheduled hours over an empty schedule.
 */
export async function applyPositionChange(
  tx: DbTx,
  input: PositionChangeInput,
): Promise<PositionChangeResult> {
  const names = await positionNames(tx, input);

  // The permanent record, written before anything is changed and never
  // replaced. Unlike the flag below it accumulates, so a student who moves
  // twice has both moves.
  await tx.insert(positionChanges).values({
    id: randomUUID(),
    studentEmail: input.email,
    fromPositionId: input.fromPositionId,
    fromPositionName: names.from,
    toPositionId: input.toPositionId,
    toPositionName: names.to,
    changedBy: input.changedBy ?? null,
    source: input.source,
  });

  const removedShifts = await removeCurrentRunShifts(tx, input.email);

  const [sub] = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentEmail, input.email))
    .limit(1);
  if (!sub) {
    return {
      hadSubmission: false,
      carriedOver: 0,
      preserved: 0,
      removedShifts,
      deferred: false,
      revalidationFailed: false,
    };
  }

  // Retired blocks are never a carry-over target: a pick that landed on one
  // would be orphaned the moment it arrived.
  const targetBlocks = input.toPositionId
    ? (
        await tx
          .select()
          .from(shiftBlocks)
          .where(and(eq(shiftBlocks.positionId, input.toPositionId), liveBlocksOnly()))
      ).map(toDomainBlock)
    : [];
  const deferred = targetBlocks.length === 0;

  let carriedOver = 0;
  let preserved = 0;
  if (!deferred) {
    const moved = await carryOverSubmission(tx, sub.id, targetBlocks);
    carriedOver = moved.carriedOver;
    preserved = moved.preserved;
  }

  // The schedule this student had is gone, so the marker saying it was built
  // has to go with it. Left set, it freezes them out of the next generated run
  // (`frozen: "marked"`) on the strength of shifts that no longer exist.
  await tx.update(submissions).set({ scheduled: false }).where(eq(submissions.id, sub.id));

  const detail = changeDetail(names, { deferred, carriedOver, preserved, removedShifts });
  // Replace any earlier position_change flag instead of stacking a second one.
  await tx
    .delete(flags)
    .where(and(eq(flags.submissionId, sub.id), eq(flags.type, "position_change")));
  await tx
    .insert(flags)
    .values({ id: randomUUID(), submissionId: sub.id, type: "position_change", detail });

  // While deferred there is no block set to validate against; the flag from a
  // previous run (if any) stays until the ghost resolves and this reruns. The
  // same goes for orphans: with no live blocks to compare against, every row
  // would read as dead, and the admin's only affordance for a dead row is to
  // delete it. `syncOrphanedSelectionFlag` refuses that case too, so this is
  // belt and braces; the deferred rows are waiting for the carry-over, not
  // rotten. `createBlock` runs the carry-over once blocks do exist.
  const revalidationFailed = deferred ? false : await syncRevalidationFlag(tx, sub.id);
  if (!deferred) await syncOrphanedSelectionFlag(tx, sub.id);

  return { hadSubmission: true, carriedOver, preserved, removedShifts, deferred, revalidationFailed };
}

/**
 * Drop this student's shifts from the run the schedule surfaces read.
 *
 * Shifts never transfer. A shift is a seat on a specific block of a specific
 * position, so one the student no longer holds means nothing, and the scheduler
 * rebuilds from the new position rather than inheriting a mapping nobody chose.
 *
 * Only the CURRENT run. Superseded runs and pinned snapshots are the record of
 * what was generated while the student really did hold that position, and
 * rewriting history to match the present would be a lie about both.
 */
async function removeCurrentRunShifts(tx: DbTx, email: string): Promise<number> {
  const [run] = await tx
    .select({ id: scheduleRuns.id })
    .from(scheduleRuns)
    .where(eq(scheduleRuns.status, "current"))
    .limit(1);
  if (!run) return 0;

  const doomed = await tx
    .select({ blockId: scheduleAssignments.shiftBlockId })
    .from(scheduleAssignments)
    .where(
      and(eq(scheduleAssignments.runId, run.id), eq(scheduleAssignments.studentEmail, email)),
    );
  if (doomed.length === 0) return 0;

  await tx
    .delete(scheduleAssignments)
    .where(
      and(eq(scheduleAssignments.runId, run.id), eq(scheduleAssignments.studentEmail, email)),
    );
  return doomed.length;
}

/**
 * Re-point one submission's cells (the student's own and the internal copy
 * alike) onto `targetBlocks`, in both selection tables. Only picks on LIVE
 * source blocks move: carry-over matches on time, so an orphaned pick whose
 * retired block happens to share hours with a target block would come back as
 * a real pick the student never re-offered. Orphans stay orphans, rows
 * untouched.
 *
 * A pick with no counterpart in the new position is NOT deleted either. It
 * stays on the old block and becomes an orphan, which is what makes it visible:
 * the admin gets a read-only row in the grid and can clear it deliberately.
 * Only the carry-over's own leftovers go (`consumed`: the originals it
 * re-pointed, and the losers of a same-time collapse). Counts describe the
 * student's own rows.
 */
async function carryOverSubmission(
  tx: DbTx,
  submissionId: string,
  targetBlocks: ReturnType<typeof toDomainBlock>[],
): Promise<{ carriedOver: number; preserved: number }> {
  const remap = async (table: typeof shiftSelections | typeof internalSelections) => {
    const rows = await tx
      .select({ blockId: table.shiftBlockId, day: table.day, autoAssigned: table.autoAssigned })
      .from(table)
      .where(eq(table.submissionId, submissionId));
    if (rows.length === 0) return { kept: 0, preserved: 0 };
    // Source blocks are the blocks the rows actually reference (see header).
    const referencedIds = [...new Set(rows.map((r) => r.blockId))];
    const sourceRows = await tx
      .select()
      .from(shiftBlocks)
      .where(inArray(shiftBlocks.id, referencedIds));
    const liveSource = sourceRows.filter(isLiveBlock);
    const liveSourceIds = new Set(liveSource.map((b) => b.id));
    const liveRows = rows.filter((r) => liveSourceIds.has(r.blockId));
    const result = carryOverSelections(liveRows, liveSource.map(toDomainBlock), targetBlocks);
    // Delete exactly what the carry-over used up, row by row rather than by
    // source block: rows on the same block that found no counterpart have to
    // survive this delete, and a blanket one by block id would take them.
    // Kept rows are already deduped against the composite PK (submissionId,
    // shiftBlockId, day) by carryOverSelections.
    if (result.consumed.length > 0) {
      await tx.delete(table).where(
        and(
          eq(table.submissionId, submissionId),
          or(
            ...result.consumed.map((r) =>
              and(eq(table.shiftBlockId, r.blockId), eq(table.day, r.day)),
            ),
          ),
        ),
      );
    }
    if (result.kept.length > 0) {
      await tx.insert(table).values(
        result.kept.map((r) => ({
          submissionId,
          shiftBlockId: r.blockId,
          day: r.day,
          autoAssigned: r.autoAssigned,
        })),
      );
    }
    return { kept: result.kept.length, preserved: result.unmatched.length };
  };

  const own = await remap(shiftSelections);
  // The admin's internal copy (PLAN §10a) follows the same carry-over, so its
  // cells never point at another position's blocks (the engine silently drops
  // out-of-position cells). The counts report the student's own rows; the
  // internal copy is scheduler working state.
  await remap(internalSelections);
  return { carriedOver: own.kept, preserved: own.preserved };
}

/**
 * Finish the carry-over a deferred position change left pending, now that
 * `positionId` finally has blocks. A ghost resolution creates the position
 * before its shifts exist (PLAN §6.2a), so the students' cells sit on their
 * old position's blocks until this runs. Without it every one of those rows
 * would read as orphaned the moment the first block is added, inviting an
 * admin to delete a whole real availability.
 *
 * Returns how many submissions it moved.
 */
export async function resolveDeferredCarryOver(tx: DbTx, positionId: string): Promise<number> {
  const targetBlocks = (
    await tx
      .select()
      .from(shiftBlocks)
      .where(and(eq(shiftBlocks.positionId, positionId), liveBlocksOnly()))
  ).map(toDomainBlock);
  if (targetBlocks.length === 0) return 0;

  const rows = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(eq(students.positionId, positionId));

  for (const { id } of rows) {
    await carryOverSubmission(tx, id, targetBlocks);
    await syncRevalidationFlag(tx, id);
    await syncOrphanedSelectionFlag(tx, id);
  }
  return rows.length;
}

/** The two position names as they read right now, snapshotted onto the history row. */
interface ChangeNames {
  from: string | null;
  to: string | null;
}

async function positionNames(tx: DbTx, input: PositionChangeInput): Promise<ChangeNames> {
  const ids = [input.fromPositionId, input.toPositionId].filter((v): v is string => v !== null);
  const nameRows =
    ids.length > 0
      ? await tx
          .select({ id: positions.id, name: positions.name })
          .from(positions)
          .where(inArray(positions.id, ids))
      : [];
  // Falling back to the id keeps the history readable rather than blank when a
  // position row is missing, which is the whole reason the name is stored.
  const nameOf = (id: string | null) =>
    id === null ? null : (nameRows.find((r) => r.id === id)?.name ?? id);
  return { from: nameOf(input.fromPositionId), to: nameOf(input.toPositionId) };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Human copy for the position_change flag detail. */
function changeDetail(
  names: ChangeNames,
  outcome: { deferred: boolean; carriedOver: number; preserved: number; removedShifts: number },
): string {
  const parts = [
    names.from && names.to
      ? `Position changed from ${names.from} to ${names.to}.`
      : names.from
        ? `Position changed from ${names.from}.`
        : `Position set to ${names.to}.`,
  ];

  if (outcome.deferred) {
    parts.push(
      names.to
        ? `${names.to} has no shifts set up yet, so shift picks are unchanged.`
        : "The new title has no position yet, so shift picks are unchanged.",
    );
  } else {
    parts.push(`${count(outcome.carriedOver, "pick", "picks")} moved to the new position.`);
    if (outcome.preserved > 0) {
      parts.push(
        `${count(outcome.preserved, "pick", "picks")} did not fit and stayed on the old position. Review and clear them on the grid.`,
      );
    }
  }
  if (outcome.removedShifts > 0) {
    parts.push(
      `${count(outcome.removedShifts, "scheduled shift was", "scheduled shifts were")} removed.`,
    );
  }
  return parts.join(" ");
}

/**
 * Generic revalidation seam: re-run the same checks the wizard's submit gate
 * runs (validateAvailability hard rules plus checkDesiredHours) and sync the
 * single `revalidation_failed` flag: written with the failing rule messages
 * when validation fails, deleted the moment a run passes or the student has no
 * position. Drafts revalidate the same way as submitted forms. Returns true
 * when validation failed.
 *
 * It judges the EFFECTIVE availability (PLAN §10a): the admin's internal copy
 * when one exists, the student's own rows otherwise. The effective layer is
 * what gets scheduled, so it is the only layer whose failure means anything;
 * checking the student's rows under a copy that replaced them would report on
 * availability nobody is going to use, and would stay silent when an admin's
 * own edit is the thing that broke the rules (`saveAvailabilityFor` can be
 * told to save an invalid copy with `overrideInvalid`).
 *
 * This is admin-facing, which is what makes reading the copy allowed here: the
 * flag it writes is only ever shown to the scheduler. Student-facing surfaces
 * still never read the internal copy.
 *
 * Auto-assigned and out-of-position (orphaned) rows are excluded from either
 * layer. Internal copies are literal and never carry an auto-assigned weekend
 * anyway (PLAN §10a), so the exclusion is a no-op on that side.
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
    await tx
      .select()
      .from(shiftBlocks)
      .where(and(eq(shiftBlocks.positionId, position.id), liveBlocksOnly()))
  ).map(toDomainBlock);

  // The internal copy replaces the student's answers wholesale when it exists,
  // rotation flag included, so both halves of the effective view come from the
  // same side. `effectiveRotation` is the shared rule for the flag half.
  const [internal] = await tx
    .select({ everyWeekendOptIn: internalAvailability.everyWeekendOptIn })
    .from(internalAvailability)
    .where(eq(internalAvailability.submissionId, submissionId))
    .limit(1);
  const table = internal ? internalSelections : shiftSelections;
  const selRows = await tx
    .select({ blockId: table.shiftBlockId, day: table.day })
    .from(table)
    .where(and(eq(table.submissionId, submissionId), eq(table.autoAssigned, false)));
  // Orphaned picks are dead data and never count toward the rules.
  const { known: selection } = partitionSelection(selRows, blocks);

  const result = validateAvailability(selection, position, blocks, {
    everyWeekendOptIn: effectiveRotation(internal?.everyWeekendOptIn ?? null, row.everyWeekendOptIn),
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
