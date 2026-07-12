/**
 * Roster status for the admin import page (PLAN.md §4.2): the most recent
 * import audit row plus current roster counts, so the admin can sanity-check
 * an upload against what the database now holds.
 */
import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { students, adminUsers, rosterImports } from "@/lib/db/schema";
import { listGhostTitles, type GhostTitle } from "@/lib/positions/data";

export interface RosterStatus {
  lastImport: { importedAt: Date; rowCount: number; importedBy: string } | null;
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
  const [last] = await db
    .select({
      importedAt: rosterImports.importedAt,
      rowCount: rosterImports.rowCount,
      importedBy: rosterImports.importedBy,
    })
    .from(rosterImports)
    .orderBy(desc(rosterImports.importedAt))
    .limit(1);

  const count = async (where?: ReturnType<typeof eq>) => {
    const q = db.select({ n: sql<number>`count(*)` }).from(students);
    const rows = where ? await q.where(where) : await q;
    return Number(rows[0]?.n ?? 0);
  };
  const onRoster = await count(eq(students.onRoster, true));
  const offRoster = await count(eq(students.onRoster, false));
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
