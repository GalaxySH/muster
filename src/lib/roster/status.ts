/**
 * Roster status for the admin import page (PLAN.md §4.2): the most recent
 * import audit row plus current roster counts, so the admin can sanity-check
 * an upload against what the database now holds.
 */
import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adminUsers, rosterImports, termMembers } from "@/lib/db/schema";
import { listGhostTitles, type GhostTitle } from "@/lib/positions/data";
import { currentTermId } from "@/lib/terms/current";

export interface RosterStatus {
  lastImport: {
    importedAt: Date;
    rowCount: number;
    importedBy: string;
    /** Rows the import skipped for a non-wisc.edu email (never reached the roster). */
    skippedNonWisc: number;
  } | null;
  onRoster: number;
  offRoster: number;
  admins: number;
  /**
   * Ghost titles: on-roster students with no position, grouped by their
   * stored roster title (null when an older import predates roster_title),
   * largest group first. Resolved on /admin/positions.
   */
  ghostTitles: GhostTitle[];
}

export async function getRosterStatus(): Promise<RosterStatus> {
  const db = getDb();
  const termId = await currentTermId();
  const [last] = await db
    .select({
      importedAt: rosterImports.importedAt,
      rowCount: rosterImports.rowCount,
      importedBy: rosterImports.importedBy,
      skippedNonWisc: rosterImports.skippedNonWisc,
    })
    .from(rosterImports)
    .where(eq(rosterImports.termId, termId))
    .orderBy(desc(rosterImports.importedAt))
    .limit(1);

  const count = async (onRoster: boolean) => {
    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(termMembers)
      .where(and(eq(termMembers.termId, termId), eq(termMembers.onRoster, onRoster)));
    return Number(rows[0]?.n ?? 0);
  };
  const onRoster = await count(true);
  const offRoster = await count(false);
  const adminRows = await db.select({ n: sql<number>`count(*)` }).from(adminUsers);
  const ghostTitles = await listGhostTitles();

  return {
    lastImport: last ?? null,
    onRoster,
    offRoster,
    admins: Number(adminRows[0]?.n ?? 0),
    ghostTitles,
  };
}
