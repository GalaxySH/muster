"use server";

/**
 * Admin mutation for the recommended schedule (docs/schedule-generation-plan.md
 * §4): one "Update schedule" action. Students marked scheduled are frozen (their
 * current rows carry forward verbatim); everyone else is re-solved in FCFS
 * order by the pure engine. Runs are append-only: the action writes a new run,
 * flips the old one to superseded, and prunes beyond a retention count, so any
 * generation can be restored later and nothing is ever lost.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  positions,
  scheduleAssignments,
  scheduleRuns,
  shiftBlocks,
  shiftSelections,
  students,
  submissions,
} from "@/lib/db/schema";
import { toDomainBlock, toDomainPosition } from "@/lib/db/mappers";
import { requireAdmin } from "@/lib/auth/require-admin";
import { applyInternalOverrides } from "@/lib/availability/effective";
import { loadInternalCopiesByEmail } from "@/lib/availability/internal";
import {
  SCHEDULE_SHEET,
  SHEET_MANUAL_COOLDOWN_MS,
  syncSheet,
  trySyncSheet,
  type SheetSyncResult,
} from "@/lib/admin/sheet-sync";
import { deriveOpenClose } from "@/lib/domain/blocks";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { fullAvailability } from "@/lib/domain/scheduling/availability";
import { generateAssignments } from "@/lib/domain/scheduling/engine";
import { validateSchedulingParams, type SchedulingParams } from "@/lib/domain/scheduling/params";
import type {
  Cohort,
  EngineReport,
  ScheduleAssignment,
  ScheduleStudent,
} from "@/lib/domain/scheduling/types";
import type { Day, ShiftBlock } from "@/lib/domain/types";
import { getSchedulingParams, setSetting, SETTING_SCHEDULE_PARAMS } from "@/lib/settings";
import { loadRepairSeeds, type RepairEligibleStudent } from "@/lib/w2w/repair";
import { eligibleSubmittedFilter, loadCurrentRunRow } from "./data";

/** Superseded runs kept for restore before pruning. */
const RUN_RETENTION = 10;

/**
 * The Shift Lead weekend closing block, which the engine fills only as a last
 * resort. Shift Leads claim their weekend closes by hand (PLAN §18a) and those
 * claims never reach the generator, so a generated close would double-book the
 * slot the manual flow is about to fill.
 */
/** Emails a stored run scheduled as fill-ins; empty when the report is unreadable. */
function readFillIns(summaryJson: string | undefined): string[] {
  if (!summaryJson) return [];
  try {
    const report = JSON.parse(summaryJson) as EngineReport;
    return (report.students ?? []).filter((s) => s.fillIn).map((s) => s.email);
  } catch {
    return [];
  }
}

function shiftLeadWeekendCloseIds(blocks: readonly ShiftBlock[]): string[] {
  const weekend = blocks.filter(
    (b) => b.positionId === SHIFT_LEAD_POSITION_ID && b.dayType === "weekend",
  );
  const { closeId } = deriveOpenClose(weekend);
  return closeId ? [closeId] : [];
}

export interface GenerateResult {
  ok: boolean;
  error?: string;
  /** Assignment rows the new run holds (on success). */
  placed?: number;
  /** Repair mode: how much of the imported plan was kept in place. */
  repaired?: {
    students: number;
    cells: number;
    /** Students fully re-solved because one of their placements broke. */
    brokenStudents: string[];
    skippedNames: string[];
    skippedCells: number;
  };
}

export interface GenerateOptions {
  /**
   * Repair-only mode (docs/w2w-shift-plan-roundtrip.md §7): keep every valid
   * placement the imported W2W plan carries (those students are frozen for
   * this run) and re-solve only the rest. Default is the full refill.
   */
  repairFromPlan?: boolean;
  /**
   * Also schedule on-roster students who never submitted, treating them as
   * available for every cell their position runs. Off by default: the admin
   * opts in per run on /admin/schedule.
   */
  includeNonResponders?: boolean;
}

export async function generateSchedule(options: GenerateOptions = {}): Promise<GenerateResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [positionRows, blockRows, studentRows, selectionRows, internalByEmail, currentRun, params] =
    await Promise.all([
      db.select().from(positions),
      // Retired blocks never enter a run: a pick left on one is orphaned, and
      // the engine skips any cell whose block is not in this map.
      db.select().from(shiftBlocks).where(isNull(shiftBlocks.retiredAt)),
      db
        .select({
          email: students.email,
          positionId: students.positionId,
          international: students.international,
          everyWeekendOptIn: submissions.everyWeekendOptIn,
          desiredHours: submissions.desiredHours,
          submittedAt: submissions.submittedAt,
          scheduled: submissions.scheduled,
        })
        .from(submissions)
        .innerJoin(students, eq(submissions.studentEmail, students.email))
        .where(eligibleSubmittedFilter()),
      db
        .select({
          email: submissions.studentEmail,
          blockId: shiftSelections.shiftBlockId,
          day: shiftSelections.day,
        })
        .from(shiftSelections)
        .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
        .innerJoin(students, eq(submissions.studentEmail, students.email))
        .where(eligibleSubmittedFilter()),
      loadInternalCopiesByEmail(),
      loadCurrentRunRow(),
      getSchedulingParams(),
    ]);

  const selectionByEmail = new Map<string, { blockId: string; day: Day }[]>();
  for (const row of selectionRows) {
    const list = selectionByEmail.get(row.email) ?? [];
    list.push({ blockId: row.blockId, day: row.day });
    selectionByEmail.set(row.email, list);
  }

  // The engine consumes the EFFECTIVE availability (PLAN §10a): where an admin
  // saved an internal copy, its cells and rotation replace the student's here.
  const engineStudents: ScheduleStudent[] = applyInternalOverrides(
    studentRows.map((r) => ({
      email: r.email,
      positionId: r.positionId,
      international: r.international,
      everyWeekendOptIn: r.everyWeekendOptIn,
      desiredHours: r.desiredHours,
      submittedAt: r.submittedAt,
      scheduled: r.scheduled,
      selection: selectionByEmail.get(r.email) ?? [],
    })),
    internalByEmail,
  );

  const domainBlocks = blockRows.map(toDomainBlock);

  // Opt-in: fill what the responders left with roster members who did not
  // submit. The fillIn flag holds them back until the engine has settled
  // everyone else, so they only take capacity nobody claimed. Someone with no
  // position has nothing to schedule into, so they drop out rather than land in
  // the run's skipped list, which is about responses.
  //
  // Availability comes from the best record we hold, never the other way round:
  // an internal copy an admin wrote (§10a) wins, then the student's own draft
  // answers, and only someone who told us nothing at all is treated as
  // available for every cell their position runs. Their draft hours and weekend
  // opt-in carry over the same way, so opting a run into non-responders can
  // never overwrite what somebody actually said.
  if (options.includeNonResponders) {
    const responded = new Set(engineStudents.map((s) => s.email));
    const notSubmitted = and(eq(students.onRoster, true), ne(submissions.status, "submitted"));
    const [rosterRows, draftCells] = await Promise.all([
      db
        .select({
          email: students.email,
          positionId: students.positionId,
          international: students.international,
          everyWeekendOptIn: submissions.everyWeekendOptIn,
          desiredHours: submissions.desiredHours,
          scheduled: submissions.scheduled,
        })
        .from(students)
        .leftJoin(submissions, eq(submissions.studentEmail, students.email))
        .where(eq(students.onRoster, true)),
      db
        .select({
          email: submissions.studentEmail,
          blockId: shiftSelections.shiftBlockId,
          day: shiftSelections.day,
        })
        .from(shiftSelections)
        .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
        .innerJoin(students, eq(submissions.studentEmail, students.email))
        .where(notSubmitted),
    ]);

    const draftByEmail = new Map<string, { blockId: string; day: Day }[]>();
    for (const row of draftCells) {
      const list = draftByEmail.get(row.email) ?? [];
      list.push({ blockId: row.blockId, day: row.day });
      draftByEmail.set(row.email, list);
    }

    const nonResponders: ScheduleStudent[] = rosterRows
      .filter((r) => !responded.has(r.email) && r.positionId)
      .map((r) => {
        const drafted = draftByEmail.get(r.email);
        return {
          email: r.email,
          positionId: r.positionId,
          international: r.international,
          everyWeekendOptIn: r.everyWeekendOptIn ?? false,
          desiredHours: r.desiredHours,
          submittedAt: null,
          scheduled: r.scheduled ?? false,
          fillIn: true,
          selection: drafted?.length ? drafted : fullAvailability(r.positionId!, domainBlocks),
        };
      });
    engineStudents.push(...applyInternalOverrides(nonResponders, internalByEmail));
  }

  const previous: ScheduleAssignment[] = currentRun
    ? (
        await db
          .select({
            studentEmail: scheduleAssignments.studentEmail,
            blockId: scheduleAssignments.shiftBlockId,
            day: scheduleAssignments.day,
            cohort: scheduleAssignments.cohort,
            source: scheduleAssignments.source,
          })
          .from(scheduleAssignments)
          .where(eq(scheduleAssignments.runId, currentRun.id))
      ).map((r) => ({ ...r, cohort: r.cohort as Cohort }))
    : [];

  // Repair mode: the imported plan's still-valid placements become carried
  // rows and their students are frozen for this run, so the engine keeps them
  // in place and only fills gaps or re-solves broken placements. Students the
  // admin marked scheduled stay on their current-run rows, which always win.
  let engineStudentsFinal = engineStudents;
  let previousFinal = previous;
  let repaired: GenerateResult["repaired"];
  if (options.repairFromPlan) {
    const eligibleForRepair = new Map<string, RepairEligibleStudent>(
      engineStudents
        .filter((s) => !s.scheduled)
        .map((s) => [s.email, { everyWeekendOptIn: s.everyWeekendOptIn, selection: s.selection }]),
    );
    const seeds = await loadRepairSeeds(eligibleForRepair, params.dayCapHours * 60);
    if (!seeds) {
      return {
        ok: false,
        error: "No shift plan has been imported, so there is nothing to repair from.",
      };
    }
    engineStudentsFinal = engineStudents.map((s) =>
      seeds.byEmail.has(s.email) ? { ...s, scheduled: true } : s,
    );
    // A seed identical to the student's current cell keeps its manual
    // provenance, so diff views do not show untouched cells flipping source.
    const currentSource = new Map(
      previous.map((r) => [`${r.studentEmail}|${r.blockId}|${r.day}`, r.source]),
    );
    previousFinal = [
      ...previous.filter((r) => !seeds.byEmail.has(r.studentEmail)),
      ...[...seeds.byEmail.values()].flat().map((r) => ({
        ...r,
        source: currentSource.get(`${r.studentEmail}|${r.blockId}|${r.day}`),
      })),
    ];
    repaired = {
      students: seeds.byEmail.size,
      cells: [...seeds.byEmail.values()].reduce((n, list) => n + list.length, 0),
      brokenStudents: seeds.brokenStudents,
      skippedNames: seeds.skippedNames,
      skippedCells: seeds.skippedCells,
    };
  }

  // Who the last run scheduled as a fill-in, so turning the option off reads as
  // the option changing rather than as those people leaving the roster. A report
  // we cannot read costs only that distinction, and regenerating is how an admin
  // recovers from a bad run, so it must never be what blocks them.
  const previousFillIns = readFillIns(currentRun?.summaryJson);

  const result = generateAssignments({
    students: engineStudentsFinal,
    positions: positionRows.map(toDomainPosition),
    blocks: domainBlocks,
    previous: previousFinal,
    params,
    deferredBlockIds: shiftLeadWeekendCloseIds(domainBlocks),
    previousFillIns,
  });

  const runId = randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .update(scheduleRuns)
      .set({ status: "superseded" })
      .where(eq(scheduleRuns.status, "current"));
    await tx.insert(scheduleRuns).values({
      id: runId,
      generatedBy: gate.email,
      status: "current",
      // Repair runs stamp their kept-from-plan counts into the stored report
      // so the run panel can tell virtually-frozen from admin-frozen.
      summaryJson: JSON.stringify(
        repaired ? { ...result.report, repaired: { students: repaired.students } } : result.report,
      ),
    });
    // Chunked inserts: a full fall cycle is a few thousand rows.
    const rows = result.assignments.map((a) => ({
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
    // Retention ranks by restore-or-generate time, so a restored run moves to
    // the front of the queue; the current run is never pruned regardless.
    const allRuns = await tx
      .select({ id: scheduleRuns.id, status: scheduleRuns.status })
      .from(scheduleRuns)
      .orderBy(
        desc(sql`coalesce(${scheduleRuns.restoredAt}, ${scheduleRuns.generatedAt})`),
        desc(scheduleRuns.id),
      );
    const stale = allRuns.slice(RUN_RETENTION).filter((r) => r.status !== "current");
    if (stale.length > 0) {
      await tx.delete(scheduleRuns).where(
        inArray(
          scheduleRuns.id,
          stale.map((r) => r.id),
        ),
      );
    }
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin");
  await trySyncSheet(SCHEDULE_SHEET, 0);
  return { ok: true, placed: result.assignments.length, repaired };
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

/**
 * Make a superseded run the current schedule again, in place: no new run row,
 * just the status flip plus the restore stamps. Retention then treats the run
 * as fresh (it ranks by restore-or-generate time), so restoring an old run
 * does not put it next in line for pruning.
 */
class RestoreTargetVanished extends Error {}

export async function restoreScheduleRun(runId: string): Promise<RestoreResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  let error: string | null;
  try {
    error = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: scheduleRuns.id, status: scheduleRuns.status })
        .from(scheduleRuns)
        .where(eq(scheduleRuns.id, runId))
        .limit(1);
      if (!run) return "That run no longer exists.";
      if (run.status === "current") return "That run is already the current schedule.";
      await tx
        .update(scheduleRuns)
        .set({ status: "superseded" })
        .where(eq(scheduleRuns.status, "current"));
      // The guard SELECT is a snapshot read, so a concurrent generate can prune
      // the target run between it and this write. Zero rows changed means the
      // run is gone; the flip above must roll back or no run stays current.
      const [flipped] = await tx
        .update(scheduleRuns)
        .set({ status: "current", restoredAt: new Date(), restoredBy: gate.email })
        .where(eq(scheduleRuns.id, runId));
      if (flipped.affectedRows === 0) throw new RestoreTargetVanished();
      return null;
    });
  } catch (e) {
    if (!(e instanceof RestoreTargetVanished)) throw e;
    error = "That run no longer exists.";
  }
  if (error) return { ok: false, error };

  revalidatePath("/admin/schedule");
  revalidatePath("/admin");
  await trySyncSheet(SCHEDULE_SHEET, 0);
  return { ok: true };
}

export interface RebuildScheduleSheetResult {
  ok: boolean;
  error?: string;
  sync?: SheetSyncResult;
}

/**
 * Admin: rebuild the Muster Schedule spreadsheet in Drive on demand. Obeys the
 * short manual cooldown; generate and restore force their own sync.
 */
export async function rebuildScheduleSheet(): Promise<RebuildScheduleSheetResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    const sync = await syncSheet(SCHEDULE_SHEET, { cooldownMs: SHEET_MANUAL_COOLDOWN_MS });
    revalidatePath("/admin/schedule");
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sheet sync failed." };
  }
}

export interface SaveParamsResult {
  ok: boolean;
  error?: string;
}

/**
 * Save the engine's tunable knobs (domain/scheduling/params.ts). They apply
 * from the next generation on; each run also snapshots the values it used
 * into its stored report.
 */
export async function saveScheduleParams(params: SchedulingParams): Promise<SaveParamsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const error = validateSchedulingParams(params);
  if (error) return { ok: false, error };

  await setSetting(SETTING_SCHEDULE_PARAMS, JSON.stringify(params));
  revalidatePath("/admin/schedule");
  return { ok: true };
}
