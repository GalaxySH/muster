/**
 * Roster import orchestrator (PLAN.md §4.2).
 *
 * read sheet → parse/classify → upsert students + admins + audit row, all in
 * one transaction. Idempotent: re-running updates existing rows by email.
 *
 * **Being listed in the sheet is what puts someone on the roster**, and
 * dropping out of it is what takes them off; the tracker's Status column is an
 * administrative marker and is deliberately not read. Because a departure is
 * inferred from an absence, the **absence guard** is all-or-nothing: past its
 * limit the whole import is refused before anything is written, rather than
 * applying part of a file that looks wrong. Someone taken off the roster has
 * their SL closes released in the same transaction (summary `closesReleased`):
 * after their Resignation Effective Date when the workbook has a People
 * Leaving sheet that dates them; otherwise their closes from today on are
 * released only if the admin says so (`releaseUndatedCloses`), and the import
 * stops to ask (RosterClosesPrompt) before writing anything. A lead the sheet
 * moves to a position that picks no closes loses theirs from today on without
 * a question (the position-change routine does it).
 *
 * Titles map to positions through the DB-owned roster_title_mappings table
 * (alias chains resolved), and a student whose stored position differs from
 * the sheet's goes through the shared position-change routine (history, shift
 * removal, selection carry-over, flags, revalidation; roadmap 3.3). Takes a
 * Database so it's
 * decoupled from connection setup, and a workbook source that is either a
 * file path (CLI) or the uploaded bytes (admin UI).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  students,
  adminUsers,
  rosterImports,
  rosterTitleMappings,
  positions,
  closeClaims,
  closeSlots,
  submissions,
  scheduleRuns,
  scheduleAssignments,
  termMembers,
} from "@/lib/db/schema";
import { applyPositionChange, type DbTx } from "@/lib/positions/apply-change";
import { chicagoToday } from "@/lib/domain/time";
import { readRosterGrid, type WorkbookSource } from "./read-workbook";
import {
  buildEffectiveTitleMap,
} from "./position-mapping";
import {
  extractRosterRows,
  parseRoster,
  reconcileAdmins,
  evaluateAbsenceGuard,
  extractResignationDates,
  planCloseReleases,
  RosterGuardError,
  RosterClosesPrompt,
  type DatedCloseClaim,
} from "./parse";
import { currentRunOf, submissionInTerm } from "@/lib/terms/scope";
import { loadRosterConfig } from "./config-data";
import { enrollMember, takeOffRoster } from "@/lib/terms/members";
import { ensureCloseRequirements } from "@/lib/closes/requirements";

/** One student whose stored position differed from the sheet's (names, not ids). */
export interface PositionChangeSummary {
  email: string;
  from: string | null;
  to: string | null;
  carriedOver: number;
  /**
   * Picks with no counterpart in the new position, left where they are rather
   * than deleted. Each is now an orphan the admin can review and clear.
   */
  preserved: number;
  /** Current-run shifts removed, because they were on the old position. */
  removedShifts: number;
  /** True when the picks were left untouched: the new title has no position or no blocks yet. */
  deferred: boolean;
  revalidationFailed: boolean;
}

export interface ImportSummary {
  importId: string;
  /** The worksheet read, or null for a CSV. */
  sheetName: string | null;
  /** Data rows read from the sheet (blank rows excluded); reconcile against the file. */
  sheetRows: number;
  studentsUpserted: number;
  adminsUpserted: number;
  /**
   * Emails taken off the roster because this sheet no longer lists them. Always
   * applied: past the guard's limit the whole import is refused instead
   * (RosterGuardError), so a summary never reports a partly applied run.
   */
  deactivatedByAbsence: string[];
  /**
   * Emails the sheet classifies as admins that held an active student row:
   * promoted to a supervisor title, so the student row was flipped off-roster
   * (their submission stays; admin access comes from admin_users).
   */
  movedToAdmin: string[];
  /**
   * SL close claims given back to the pool: held by someone this import took
   * off the roster, on a close after their People Leaving Resignation
   * Effective Date, or from today on when undated and the admin said to.
   * Also the upcoming closes of a Shift Lead the sheet moved to another
   * position, which are freed without asking and listed here.
   * One entry per claim (slot date `yyyy-mm-dd`).
   */
  closesReleased: { email: string; date: string }[];
  skipped: { reason: string; detail: string }[];
  unmappedTitles: Record<string, number>;
  byPosition: Record<string, number>;
  /**
   * Active students whose stored position differed from the incoming one
   * (including to/from none): the shared routine ran for each (change
   * recorded, current-run shifts removed, selections re-pointed where a target
   * block has identical times and the rest left in place as orphans,
   * position_change flagged, availability revalidated).
   */
  positionChanges: PositionChangeSummary[];
}

export interface ImportOptions {
  db: Database;
  /** The term to import into. The caller resolves it; this function never reads another. */
  termId: string;
  /**
   * True when `termId` is the current term. Names, the international flag,
   * hire dates and the admin list follow the current term: an import into an
   * earlier one only changes that term's roster and adds people not seen
   * before, so an old tracker cannot overwrite today's names or admins
   * (docs/semester-domains-plan.md §2.3).
   */
  updatePeople: boolean;
  workbook: WorkbookSource;
  importedBy: string;
  /** Worksheet to read; defaults to the first of the term's sheet candidates present. */
  sheetName?: string;
  /** Run even when the guard would refuse the import for taking too many people off. */
  allowMassDeactivation?: boolean;
  /**
   * The admin's answer for leavers with no resignation date who hold closes
   * from today on: true frees those closes, false keeps them. Left unset, the
   * import stops with RosterClosesPrompt when there is anything to ask.
   */
  releaseUndatedCloses?: boolean;
}

export async function importRoster({
  db,
  termId,
  updatePeople,
  workbook,
  importedBy,
  sheetName: requestedSheet,
  allowMassDeactivation = false,
  releaseUndatedCloses,
}: ImportOptions): Promise<ImportSummary> {
  // How the file is read is the term's own: sheet and column names, the titles
  // that mean admin and the titles to skip (edited on /admin/roster).
  const config = await loadRosterConfig(db, termId);
  const { sheetName, grid, leavingGrid } = await readRosterGrid(workbook, requestedSheet, config);
  const rows = extractRosterRows(grid, config.columns);
  const resignations = leavingGrid
    ? extractResignationDates(leavingGrid)
    : new Map<string, string>();

  // The title map is DB-owned (seeded once from the code fixture, extended by
  // ghost resolution on /admin/positions); aliases canonicalize before writes.
  const [mappingRows, positionRows] = await Promise.all([
    db.select().from(rosterTitleMappings).where(eq(rosterTitleMappings.termId, termId)),
    db
      .select({ id: positions.id, name: positions.name, mergedIntoId: positions.mergedIntoId })
      .from(positions)
      .where(eq(positions.termId, termId)),
  ]);
  const parsed = parseRoster(
    rows,
    buildEffectiveTitleMap(mappingRows, positionRows),
    config.excludedTitles,
    config.adminTitles,
  );
  const importId = randomUUID();

  // Pre-read the term's whole roster once: onRoster status feeds the
  // deactivation sets below, stored positions feed the change detection in the
  // transaction. Only this term: another term's roster is not this import's
  // business (docs/semester-domains-plan.md §2.3).
  const existing = await db
    .select({
      email: termMembers.studentEmail,
      positionId: termMembers.positionId,
      onRoster: termMembers.onRoster,
    })
    .from(termMembers)
    .where(eq(termMembers.termId, termId));
  const priorPosition = new Map(existing.map((r) => [r.email, r.positionId]));
  const onRosterEmails = new Set(existing.filter((r) => r.onRoster).map((r) => r.email));

  // Promoted into a supervisor title: the admin_users upsert alone would leave
  // their old student row active with a stale position, so flip it off-roster.
  const movedToAdmin = reconcileAdmins(parsed, onRosterEmails);

  // Departure: on-roster here, no longer listed in the sheet.
  const deactivatedByAbsence = [...onRosterEmails]
    .filter((email) => !parsed.seenEmails.has(email))
    .sort();

  // All-or-nothing: refuse the whole import rather than apply half of a file
  // that looks wrong. Thrown before the transaction, so nothing is written.
  const guard = evaluateAbsenceGuard(
    deactivatedByAbsence.length,
    onRosterEmails.size,
    allowMassDeactivation,
  );
  if (guard.blocked) {
    throw new RosterGuardError(deactivatedByAbsence, guard.limit, onRosterEmails.size);
  }

  const deactivate = [...new Set([...deactivatedByAbsence, ...movedToAdmin])];

  // Closes held by the people leaving: after their People Leaving date they
  // go back to the pool; with no date, the admin decides about today onward.
  // Like the guard, the question is asked before anything is written.
  const held =
    deactivate.length === 0
      ? []
      : await db
          .select({
            closeSlotId: closeClaims.closeSlotId,
            studentEmail: closeClaims.studentEmail,
            date: closeSlots.date,
          })
          .from(closeClaims)
          .innerJoin(closeSlots, eq(closeClaims.closeSlotId, closeSlots.id))
          .where(
            and(inArray(closeClaims.studentEmail, deactivate), eq(closeSlots.termId, termId)),
          );
  const plan = planCloseReleases(held, new Set(deactivate), resignations, chicagoToday(new Date()));
  const toClaimList = (claims: DatedCloseClaim[]) =>
    claims.map((c) => ({ email: c.studentEmail, date: c.date }));
  if (plan.undated.length > 0 && releaseUndatedCloses === undefined) {
    throw new RosterClosesPrompt(toClaimList(plan.undated));
  }
  const release = releaseUndatedCloses ? [...plan.dated, ...plan.undated] : plan.dated;

  const positionName = new Map(positionRows.map((p) => [p.id, p.name]));
  const nameOf = (id: string | null) => (id === null ? null : (positionName.get(id) ?? id));
  const positionChanges: PositionChangeSummary[] = [];
  const closesFromMoves: { email: string; date: string }[] = [];

  await db.transaction(async (tx) => {
    for (const s of parsed.students) {
      await tx
        .insert(students)
        .values({
          email: s.email,
          displayName: s.displayName,
          international: s.international,
          hiredOn: s.hiredOn,
        })
        .onDuplicateKeyUpdate({
          set: updatePeople
            ? { displayName: s.displayName, international: s.international, hiredOn: s.hiredOn }
            : // Someone already known keeps what the current term says about them.
              { email: s.email },
        });
      // The person above, their place in this term here.
      await enrollMember(tx, termId, s.email, {
        positionId: s.positionId,
        onRoster: true,
        rosterTitle: s.rosterTitle,
      });

      // Position change (only ever from active rows; deactivations just flip
      // onRoster): run the shared routine, which records the change, drops the
      // shifts the old position left behind, carries what picks still fit, and
      // re-runs the checks.
      const hadRow = priorPosition.has(s.email);
      const before = priorPosition.get(s.email) ?? null;
      // Keep the in-memory view current so a duplicate row for the same email
      // compares against what the first row just wrote.
      priorPosition.set(s.email, s.positionId);
      if (!hadRow || before === s.positionId) continue;
      const change = await applyPositionChange(tx, {
        email: s.email,
        termId,
        fromPositionId: before,
        toPositionId: s.positionId,
        source: "roster_import",
        changedBy: importedBy,
      });
      for (const date of change.releasedCloses) closesFromMoves.push({ email: s.email, date });
      positionChanges.push({
        email: s.email,
        from: nameOf(before),
        to: nameOf(s.positionId),
        carriedOver: change.carriedOver,
        preserved: change.preserved,
        removedShifts: change.removedShifts,
        deferred: change.deferred,
        revalidationFailed: change.revalidationFailed,
      });
    }

    for (const a of updatePeople ? parsed.admins : []) {
      await tx
        .insert(adminUsers)
        .values({ email: a.email })
        .onDuplicateKeyUpdate({ set: { email: a.email } });
    }

    // Only ever an onRoster flip, never a delete: the name, position and any
    // submission are kept, so someone re-listed later comes straight back.
    if (deactivate.length > 0) {
      await takeOffRoster(tx, termId, deactivate);
      await releaseDepartedSchedules(tx, deactivate, termId);
    }

    // The same delete as an admin unassign. Leads hold at most a few claims each.
    for (const c of release) {
      await tx
        .delete(closeClaims)
        .where(
          and(
            eq(closeClaims.closeSlotId, c.closeSlotId),
            eq(closeClaims.studentEmail, c.studentEmail),
          ),
        );
    }

    // Anyone the sheet made a lead (a new hire, a promotion) gets their number.
    await ensureCloseRequirements(tx, termId);

    await tx.insert(rosterImports).values({
      termId,
      id: importId,
      rowCount: parsed.students.length + parsed.admins.length,
      importedBy,
      skippedNonWisc: parsed.skipped.filter((s) => s.reason === "non_wisc_email").length,
    });
  });

  const byPosition: Record<string, number> = {};
  for (const s of parsed.students) {
    const key = s.positionId ?? "(unassigned)";
    byPosition[key] = (byPosition[key] ?? 0) + 1;
  }

  return {
    importId,
    sheetName,
    sheetRows: rows.length,
    studentsUpserted: parsed.students.length,
    adminsUpserted: parsed.admins.length,
    deactivatedByAbsence,
    movedToAdmin,
    closesReleased: [...toClaimList(release), ...closesFromMoves],
    skipped: parsed.skipped,
    unmappedTitles: Object.fromEntries(parsed.unmappedTitles),
    byPosition,
    positionChanges,
  };
}

/**
 * A departed student's schedule, if any, no longer applies: unmark the
 * generator's freeze (`submissions.scheduled`) and drop their rows from the
 * CURRENT run. Mirrors the same two steps `applyPositionChange` runs for a
 * position change (`positions/apply-change.ts`), for the same reason: left
 * set, `scheduled` would freeze a later rehire out of the next generated run
 * on the strength of a schedule from before they left. Superseded and pinned
 * runs are untouched, since they're the record of what was true while the
 * student really was on the roster.
 *
 * Batched rather than per email (`apply-change.ts`'s `removeCurrentRunShifts`
 * is one-at-a-time, built for a single position change): the absence guard
 * alone can pass up to 20% of the roster through here in one import.
 */
export async function releaseDepartedSchedules(
  tx: DbTx,
  emails: string[],
  termId: string,
): Promise<void> {
  if (emails.length === 0) return;

  await tx
    .update(submissions)
    .set({ scheduled: false })
    .where(and(inArray(submissions.studentEmail, emails), submissionInTerm(termId)));

  const [run] = await tx
    .select({ id: scheduleRuns.id })
    .from(scheduleRuns)
    .where(currentRunOf(termId))
    .limit(1);
  if (!run) return;

  await tx
    .delete(scheduleAssignments)
    .where(
      and(eq(scheduleAssignments.runId, run.id), inArray(scheduleAssignments.studentEmail, emails)),
    );
}
