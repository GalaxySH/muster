import "server-only";

/**
 * The one way a new run becomes the current schedule, and the retention prune
 * that goes with it. It lives beside the action rather than inside it because
 * `actions.ts` is a "use server" module, where every export becomes a callable
 * endpoint: a helper that writes a whole run must not be one of those. The
 * plan import in `lib/admin/plan-import-actions.ts` writes a run too, and the
 * console is the layer allowed to compose the generator with W2W.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { scheduleAssignments, scheduleRuns } from "@/lib/db/schema";
import { staleRunIds } from "@/lib/domain/scheduling/retention";
import type { ScheduleAssignment, StoredRunReport } from "@/lib/domain/scheduling/types";

/** A drizzle transaction handle. */
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Superseded runs kept for restore before pruning; pinned runs bypass this entirely. */
const RUN_RETENTION = 10;

/**
 * Deletes runs `staleRunIds` (domain/scheduling/retention.ts) marks stale:
 * beyond the retention count on the restore-or-generate clock, excluding the
 * current run and any pinned run. Shared by generation and by saving a
 * snapshot, since both add a row that can push an old one out of the window.
 */
export async function pruneStaleRuns(tx: DbTx): Promise<void> {
  const allRuns = await tx
    .select({
      id: scheduleRuns.id,
      status: scheduleRuns.status,
      pinned: scheduleRuns.pinned,
      generatedAt: scheduleRuns.generatedAt,
      restoredAt: scheduleRuns.restoredAt,
    })
    .from(scheduleRuns);
  const stale = staleRunIds(
    allRuns.map((r) => ({ ...r, rankedAt: r.restoredAt ?? r.generatedAt })),
    RUN_RETENTION,
  );
  if (stale.length > 0) {
    await tx.delete(scheduleRuns).where(inArray(scheduleRuns.id, stale));
  }
}

/**
 * Append the run that becomes the current schedule: supersede whatever was
 * current, insert the row, insert its assignments, prune. Every path that makes
 * a new current run goes through here, so none of them can disagree about the
 * order of those four writes or forget the prune.
 *
 * Caller-supplied `kind` and `scopeJson` because they say what the run IS, and
 * only the caller knows: the scope ledger reads both to decide whether a slice
 * was re-solved.
 */
export async function writeRunAsCurrent(
  tx: DbTx,
  args: {
    assignments: readonly ScheduleAssignment[];
    report: StoredRunReport;
    generatedBy: string;
    kind: "generated" | "snapshot";
    scopeJson?: string | null;
  },
): Promise<string> {
  const runId = randomUUID();
  await tx
    .update(scheduleRuns)
    .set({ status: "superseded" })
    .where(eq(scheduleRuns.status, "current"));
  await tx.insert(scheduleRuns).values({
    id: runId,
    generatedBy: args.generatedBy,
    status: "current",
    kind: args.kind,
    scopeJson: args.scopeJson ?? null,
    summaryJson: JSON.stringify(args.report),
  });
  // Chunked inserts: a full fall cycle is a few thousand rows.
  const rows = args.assignments.map((a) => ({
    runId,
    studentEmail: a.studentEmail,
    shiftBlockId: a.blockId,
    day: a.day,
    cohort: a.cohort,
    // Frozen students' carried rows keep their source; new rows are the engine's.
    source: a.source ?? ("engine" as const),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(scheduleAssignments).values(rows.slice(i, i + 500));
  }
  await pruneStaleRuns(tx);
  return runId;
}
