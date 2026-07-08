/**
 * Roster import orchestrator (PLAN.md §4.2).
 *
 * read workbook → parse/classify → upsert students + admins + audit row, all
 * in one transaction. Idempotent: re-running updates existing rows by email.
 * Takes a Database so it's decoupled from connection setup, and a workbook
 * source that is either a file path (CLI) or the uploaded bytes (admin UI).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { students, adminUsers, rosterImports } from "@/lib/db/schema";
import { readPeopleComing, readPeopleLeaving, type WorkbookSource } from "./read-workbook";
import { parseRoster, parseLeaving, reconcileLeaving } from "./parse";

export interface ImportSummary {
  importId: string;
  studentsUpserted: number;
  adminsUpserted: number;
  /** People Leaving rows upserted as off-roster (onRoster: false). */
  leftMarked: number;
  /**
   * Emails in BOTH sheets — a promotion/position change moves the old row to
   * "People Leaving" and adds a fresh "People Coming" entry. People Coming
   * wins: they stay on-roster with the new classification; reported here.
   */
  movedWithinWorkbook: string[];
  /**
   * Emails still on-roster in the DB that appear in NEITHER sheet of this
   * workbook. The import never removes them (only "People Leaving" flips a
   * student off-roster), so they're surfaced for the admin to reconcile.
   */
  unlistedOnRoster: string[];
  /** Raw data rows read per sheet (blank rows excluded) — reconcile against the workbook. */
  sheetRows: { peopleComing: number; peopleLeaving: number };
  skipped: { reason: string; detail: string }[];
  unmappedTitles: Record<string, number>;
  byPosition: Record<string, number>;
}

export interface ImportOptions {
  db: Database;
  workbook: WorkbookSource;
  importedBy: string;
}

export async function importRoster({
  db,
  workbook,
  importedBy,
}: ImportOptions): Promise<ImportSummary> {
  const rows = await readPeopleComing(workbook);
  const parsed = parseRoster(rows);
  // Tolerant of older single-sheet workbooks: missing "People Leaving" → [].
  const leavingRows = await readPeopleLeaving(workbook);
  const leaving = parseLeaving(leavingRows);
  // A person in both sheets was promoted/moved, not fired: People Coming wins.
  const { markLeft, movedWithinWorkbook } = reconcileLeaving(parsed, leaving);
  const importId = randomUUID();

  // Drift check (computed against the pre-import roster): anyone on-roster but
  // absent from both sheets keeps their status — flag them so a person quietly
  // dropped from the workbook doesn't linger unnoticed.
  const mentioned = new Set<string>([
    ...parsed.students.map((s) => s.email),
    ...parsed.admins.map((a) => a.email),
    ...leaving.map((l) => l.email),
  ]);
  const onRosterNow = await db
    .select({ email: students.email })
    .from(students)
    .where(eq(students.onRoster, true));
  const unlistedOnRoster = onRosterNow
    .map((r) => r.email)
    .filter((email) => !mentioned.has(email))
    .sort();

  await db.transaction(async (tx) => {
    for (const s of parsed.students) {
      await tx
        .insert(students)
        .values({
          email: s.email,
          displayName: s.displayName,
          positionId: s.positionId,
          international: s.international,
          onRoster: true,
        })
        .onDuplicateKeyUpdate({
          set: {
            displayName: s.displayName,
            positionId: s.positionId,
            international: s.international,
            onRoster: true,
          },
        });
    }

    // Only people NOT also in People Coming (see reconcileLeaving). On an
    // existing row we only flip onRoster — never clobber position/displayName.
    for (const l of markLeft) {
      await tx
        .insert(students)
        .values({
          email: l.email,
          displayName: l.displayName,
          positionId: null,
          international: false,
          onRoster: false,
        })
        .onDuplicateKeyUpdate({ set: { onRoster: false } });
    }

    for (const a of parsed.admins) {
      await tx
        .insert(adminUsers)
        .values({ email: a.email })
        .onDuplicateKeyUpdate({ set: { email: a.email } });
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
    studentsUpserted: parsed.students.length,
    adminsUpserted: parsed.admins.length,
    leftMarked: markLeft.length,
    movedWithinWorkbook: movedWithinWorkbook.map((m) => m.email).sort(),
    unlistedOnRoster,
    sheetRows: { peopleComing: rows.length, peopleLeaving: leavingRows.length },
    skipped: parsed.skipped,
    unmappedTitles: Object.fromEntries(parsed.unmappedTitles),
    byPosition,
  };
}
