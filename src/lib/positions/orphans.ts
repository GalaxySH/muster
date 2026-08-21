/**
 * Orphaned selection cells: the server side of domain/orphans.ts.
 *
 * A pick becomes orphaned when the admin retires the block it points at (a
 * block with picks can't be deleted, so `deleteBlock` retires it instead) or
 * when a position change leaves the row pointing at another position's blocks.
 * The row survives, but it is dead data: every live read filters retired
 * blocks out, so orphaned picks never reach a grid the student sees, the
 * capacity math, coverage, the export, or the generator.
 *
 * What they do reach is the admin. `syncOrphanedSelectionFlag` keeps a single
 * `orphaned_selection` flag in step with the stored rows, and
 * `loadOrphanedCells` resolves the rows back to the times the student
 * originally picked so the per-student grid can show them.
 *
 * Both the student's own rows and the admin's internal copy can carry
 * orphans, and a removal clears the cell from both: a dead pick is dead in
 * every copy, so the admin never has to hunt the same shift twice.
 *
 * Plain server-side module (no `server-only`): the roster importer reaches it
 * through applyPositionChange from the CLI as well as the admin upload.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { liveBlocksOnly } from "@/lib/db/blocks";
import type { Database } from "@/lib/db/client";
import {
  flags,
  internalSelections,
  shiftBlocks,
  shiftSelections,
  students,
  submissions,
} from "@/lib/db/schema";
import { formatTime } from "@/lib/domain/time";
import { DAY_LABEL, type Day, type DayType } from "@/lib/domain/types";

/** A drizzle transaction handle, matching the one applyPositionChange runs in. */
type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything that can run a select: the pool or a transaction. */
type Queryable = Pick<DbTx, "select">;

/** One dead pick, resolved back to the shift the student actually chose. */
export interface OrphanedCell {
  blockId: string;
  day: Day;
  dayType: DayType;
  /** minutes since midnight, from the block as it stood when it was retired. */
  start: number;
  end: number;
  /** e.g. "Mon 6:30a–10:15a". */
  label: string;
  /** True when the admin retired this block; false when it belongs elsewhere. */
  retired: boolean;
  /** True when the student picked it; false when only the internal copy has it. */
  fromStudent: boolean;
  /** True when the admin's internal copy carries it. */
  fromInternal: boolean;
}

/**
 * Every orphaned cell on a submission, earliest first, resolved against the
 * blocks the rows actually point at (retired blocks and other positions'
 * blocks included, which is the whole point).
 *
 * Returns [] when the student has no position, and when their position has no
 * live blocks at all. Both mean the position isn't set up, not that the picks
 * are rotten: the carry-over is still pending, and calling every row dead
 * would invite an admin to delete a whole real availability. An unconfigured
 * position has its own alerts on the hub.
 */
export async function loadOrphanedCells(
  db: Queryable,
  submissionId: string,
): Promise<OrphanedCell[]> {
  const [row] = await db
    .select({ positionId: students.positionId })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!row?.positionId) return [];

  const liveRows = await db
    .select({ id: shiftBlocks.id })
    .from(shiftBlocks)
    .where(and(eq(shiftBlocks.positionId, row.positionId), liveBlocksOnly()));
  if (liveRows.length === 0) return [];
  const live = new Set(liveRows.map((b) => b.id));

  const [ownRows, internalRows] = await Promise.all([
    db
      .select({ blockId: shiftSelections.shiftBlockId, day: shiftSelections.day })
      .from(shiftSelections)
      .where(eq(shiftSelections.submissionId, submissionId)),
    db
      .select({ blockId: internalSelections.shiftBlockId, day: internalSelections.day })
      .from(internalSelections)
      .where(eq(internalSelections.submissionId, submissionId)),
  ]);

  // Merge both copies per (block, day) so one dead shift is one row to clear.
  const merged = new Map<string, { blockId: string; day: Day; own: boolean; internal: boolean }>();
  const collect = (rows: { blockId: string; day: Day }[], side: "own" | "internal"): void => {
    for (const r of rows) {
      if (live.has(r.blockId)) continue;
      const key = `${r.blockId}|${r.day}`;
      const entry = merged.get(key) ?? {
        blockId: r.blockId,
        day: r.day,
        own: false,
        internal: false,
      };
      entry[side] = true;
      merged.set(key, entry);
    }
  };
  collect(ownRows, "own");
  collect(internalRows, "internal");
  if (merged.size === 0) return [];

  const blockIds = [...new Set([...merged.values()].map((m) => m.blockId))];
  const blockRows = await db
    .select({
      id: shiftBlocks.id,
      dayType: shiftBlocks.dayType,
      start: shiftBlocks.startMinutes,
      end: shiftBlocks.endMinutes,
      retiredAt: shiftBlocks.retiredAt,
    })
    .from(shiftBlocks)
    .where(inArray(shiftBlocks.id, blockIds));
  const byId = new Map(blockRows.map((b) => [b.id, b]));

  const cells: OrphanedCell[] = [];
  for (const m of merged.values()) {
    const block = byId.get(m.blockId);
    // A row whose block is gone from the table entirely has no time to show.
    // It can't happen through the app (retire keeps the row, and the FK blocks
    // a delete), so skip it rather than invent a label.
    if (!block) continue;
    cells.push({
      blockId: m.blockId,
      day: m.day,
      dayType: block.dayType,
      start: block.start,
      end: block.end,
      label: `${DAY_LABEL[m.day]} ${formatTime(block.start)}–${formatTime(block.end)}`,
      retired: block.retiredAt !== null,
      fromStudent: m.own,
      fromInternal: m.internal,
    });
  }
  cells.sort((a, b) => a.start - b.start || a.end - b.end || a.day.localeCompare(b.day));
  return cells;
}

/**
 * Keep the single `orphaned_selection` flag in step with the stored rows:
 * written with the dead shifts named when any exist, deleted the moment none
 * do. Idempotent, so every write path can just call it. Returns the count.
 */
export async function syncOrphanedSelectionFlag(tx: DbTx, submissionId: string): Promise<number> {
  const cells = await loadOrphanedCells(tx, submissionId);
  // Replace rather than accumulate, exactly as the other lifecycle flags do.
  await tx
    .delete(flags)
    .where(and(eq(flags.submissionId, submissionId), eq(flags.type, "orphaned_selection")));
  if (cells.length === 0) return 0;

  const named = cells.map((c) => c.label).join(", ");
  await tx.insert(flags).values({
    id: randomUUID(),
    submissionId,
    type: "orphaned_selection",
    detail:
      cells.length === 1
        ? `1 pick is on a shift that no longer exists: ${named}.`
        : `${cells.length} picks are on shifts that no longer exist: ${named}.`,
  });
  return cells.length;
}

/**
 * Re-sync the flag for every submission holding a pick on any of `blockIds`.
 * The entry point for block lifecycle changes (retire, restore), which move
 * many students at once.
 */
export async function syncOrphanFlagsForBlocks(tx: DbTx, blockIds: string[]): Promise<number> {
  if (blockIds.length === 0) return 0;
  const [own, internal] = await Promise.all([
    tx
      .select({ submissionId: shiftSelections.submissionId })
      .from(shiftSelections)
      .where(inArray(shiftSelections.shiftBlockId, blockIds)),
    tx
      .select({ submissionId: internalSelections.submissionId })
      .from(internalSelections)
      .where(inArray(internalSelections.shiftBlockId, blockIds)),
  ]);
  const ids = [...new Set([...own, ...internal].map((r) => r.submissionId))];
  for (const id of ids) await syncOrphanedSelectionFlag(tx, id);
  return ids.length;
}
