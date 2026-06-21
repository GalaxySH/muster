/**
 * Roster import orchestrator (PLAN.md §4.2).
 *
 * read workbook → parse/classify → upsert students + admins + audit row, all
 * in one transaction. Idempotent: re-running updates existing rows by email.
 * Takes a Database so it's decoupled from connection setup (the CLI wires that).
 */
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db/client";
import { students, adminUsers, rosterImports } from "@/lib/db/schema";
import { readPeopleComing, readPeopleLeaving } from "./read-workbook";
import { parseRoster, parseLeaving } from "./parse";

export interface ImportSummary {
  importId: string;
  studentsUpserted: number;
  adminsUpserted: number;
  /** People Leaving rows upserted as off-roster (onRoster: false). */
  leftMarked: number;
  skipped: { reason: string; detail: string }[];
  unmappedTitles: Record<string, number>;
  byPosition: Record<string, number>;
}

export interface ImportOptions {
  db: Database;
  filePath: string;
  importedBy: string;
}

export async function importRoster({
  db,
  filePath,
  importedBy,
}: ImportOptions): Promise<ImportSummary> {
  const rows = await readPeopleComing(filePath);
  const parsed = parseRoster(rows);
  // Tolerant of older single-sheet workbooks: missing "People Leaving" → [].
  const leaving = parseLeaving(await readPeopleLeaving(filePath));
  const importId = randomUUID();

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

    // People Leaving AFTER People Coming, so if someone erroneously appears in
    // both sheets, "leaving" wins (their onRoster ends up false). On an existing
    // row we only flip onRoster — never clobber stored position/displayName.
    for (const l of leaving) {
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
    leftMarked: leaving.length,
    skipped: parsed.skipped,
    unmappedTitles: Object.fromEntries(parsed.unmappedTitles),
    byPosition,
  };
}
