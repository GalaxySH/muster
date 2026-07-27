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
 * applying part of a file that looks wrong.
 *
 * Titles map to positions through the DB-owned roster_title_mappings table
 * (alias chains resolved), and a student whose stored position differs from
 * the sheet's goes through the shared position-change routine (selection
 * carry-over + flags + revalidation; roadmap 3.3). Takes a Database so it's
 * decoupled from connection setup, and a workbook source that is either a
 * file path (CLI) or the uploaded bytes (admin UI).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  students,
  adminUsers,
  rosterImports,
  rosterTitleMappings,
  positions,
  appSettings,
} from "@/lib/db/schema";
import { applyPositionChange } from "@/lib/positions/apply-change";
import { readRosterGrid, type WorkbookSource } from "./read-workbook";
import {
  buildEffectiveTitleMap,
  effectiveExcludedTitles,
  SETTING_EXCLUDED_ROSTER_TITLES,
} from "./position-mapping";
import {
  extractRosterRows,
  parseRoster,
  reconcileAdmins,
  evaluateAbsenceGuard,
  RosterGuardError,
} from "./parse";

/** One student whose stored position differed from the sheet's (names, not ids). */
export interface PositionChangeSummary {
  email: string;
  from: string | null;
  to: string | null;
  carriedOver: number;
  dropped: number;
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
  skipped: { reason: string; detail: string }[];
  unmappedTitles: Record<string, number>;
  byPosition: Record<string, number>;
  /**
   * Active students whose stored position differed from the incoming one
   * (including to/from none): the shared carry-over routine ran for each
   * (selections re-pointed where a target block has identical times, the rest
   * dropped, position_change flagged, availability revalidated).
   */
  positionChanges: PositionChangeSummary[];
}

export interface ImportOptions {
  db: Database;
  workbook: WorkbookSource;
  importedBy: string;
  /** Worksheet to read; defaults to the first of ROSTER_SHEET_CANDIDATES present. */
  sheetName?: string;
  /** Run even when the guard would refuse the import for taking too many people off. */
  allowMassDeactivation?: boolean;
}

export async function importRoster({
  db,
  workbook,
  importedBy,
  sheetName: requestedSheet,
  allowMassDeactivation = false,
}: ImportOptions): Promise<ImportSummary> {
  const { sheetName, grid } = await readRosterGrid(workbook, requestedSheet);
  const rows = extractRosterRows(grid);

  // The title map is DB-owned (seeded once from the code fixture, extended by
  // ghost resolution on /admin/positions); aliases canonicalize before writes.
  // The excluded-title list is admin config in app_settings (edited on
  // /admin/roster), falling back to the SKIP_TITLES fixture until first saved.
  const [mappingRows, positionRows, [excludedSetting]] = await Promise.all([
    db.select().from(rosterTitleMappings),
    db
      .select({ id: positions.id, name: positions.name, mergedIntoId: positions.mergedIntoId })
      .from(positions),
    db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_EXCLUDED_ROSTER_TITLES)),
  ]);
  const parsed = parseRoster(
    rows,
    buildEffectiveTitleMap(mappingRows, positionRows),
    effectiveExcludedTitles(excludedSetting?.value ?? null),
  );
  const importId = randomUUID();

  // Pre-read the whole roster once: onRoster status feeds the deactivation
  // sets below, stored positions feed the change detection in the transaction.
  const existing = await db
    .select({ email: students.email, positionId: students.positionId, onRoster: students.onRoster })
    .from(students);
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

  const positionName = new Map(positionRows.map((p) => [p.id, p.name]));
  const nameOf = (id: string | null) => (id === null ? null : (positionName.get(id) ?? id));
  const positionChanges: PositionChangeSummary[] = [];

  await db.transaction(async (tx) => {
    for (const s of parsed.students) {
      await tx
        .insert(students)
        .values({
          email: s.email,
          displayName: s.displayName,
          positionId: s.positionId,
          international: s.international,
          hiredOn: s.hiredOn,
          onRoster: true,
          rosterTitle: s.rosterTitle,
        })
        .onDuplicateKeyUpdate({
          set: {
            displayName: s.displayName,
            positionId: s.positionId,
            international: s.international,
            hiredOn: s.hiredOn,
            onRoster: true,
            rosterTitle: s.rosterTitle,
          },
        });

      // Position change (only ever from active rows; deactivations just flip
      // onRoster): run the shared carry-over + flag + revalidate routine.
      const hadRow = priorPosition.has(s.email);
      const before = priorPosition.get(s.email) ?? null;
      // Keep the in-memory view current so a duplicate row for the same email
      // compares against what the first row just wrote.
      priorPosition.set(s.email, s.positionId);
      if (!hadRow || before === s.positionId) continue;
      const change = await applyPositionChange(tx, {
        email: s.email,
        fromPositionId: before,
        toPositionId: s.positionId,
      });
      positionChanges.push({
        email: s.email,
        from: nameOf(before),
        to: nameOf(s.positionId),
        carriedOver: change.carriedOver,
        dropped: change.dropped,
        deferred: change.deferred,
        revalidationFailed: change.revalidationFailed,
      });
    }

    for (const a of parsed.admins) {
      await tx
        .insert(adminUsers)
        .values({ email: a.email })
        .onDuplicateKeyUpdate({ set: { email: a.email } });
    }

    // Only ever an onRoster flip, never a delete: the name, position and any
    // submission are kept, so someone re-listed later comes straight back.
    if (deactivate.length > 0) {
      await tx.update(students).set({ onRoster: false }).where(inArray(students.email, deactivate));
    }

    await tx.insert(rosterImports).values({
      id: importId,
      rowCount: parsed.students.length + parsed.admins.length,
      importedBy,
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
    skipped: parsed.skipped,
    unmappedTitles: Object.fromEntries(parsed.unmappedTitles),
    byPosition,
    positionChanges,
  };
}
