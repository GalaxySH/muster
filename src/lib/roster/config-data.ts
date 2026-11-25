/**
 * Reads and writes a term's roster config (see ./config). Takes a database
 * handle rather than reaching for the app's, so the CLI importer shares it.
 */
import { eq } from "drizzle-orm";
import { terms } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/terms/term-id";
import {
  parseRosterConfig,
  type RosterColumns,
  type RosterConfig,
  type RosterReading,
} from "./config";
import { SKIP_TITLES } from "./position-mapping";

/** A term's roster config with every fallback applied, ready for the import to compare against. */
export interface EffectiveRosterConfig {
  sheetCandidates: readonly string[];
  leavingSheet: string;
  adminTitles: ReadonlySet<string>;
  excludedTitles: ReadonlySet<string>;
  columns: RosterColumns;
}

async function storedConfig(db: DbOrTx, termId: string): Promise<RosterConfig> {
  const [row] = await db
    .select({ rosterConfig: terms.rosterConfig })
    .from(terms)
    .where(eq(terms.id, termId))
    .limit(1);
  return parseRosterConfig(row?.rosterConfig ?? null);
}

/**
 * The term's excluded titles are the list saved on it. A saved empty list
 * excludes nothing; the SKIP_TITLES fixture applies only until one is saved.
 */
export async function loadRosterConfig(db: DbOrTx, termId: string): Promise<EffectiveRosterConfig> {
  const config = await storedConfig(db, termId);
  return {
    sheetCandidates: config.sheetCandidates,
    leavingSheet: config.leavingSheet,
    adminTitles: new Set(config.adminTitles),
    excludedTitles: config.excludedTitles === null ? SKIP_TITLES : new Set(config.excludedTitles),
    columns: config.columns,
  };
}

/** Save the term's excluded titles (already normalized). */
export async function saveExcludedTitles(
  db: DbOrTx,
  termId: string,
  titles: string[],
): Promise<void> {
  const config = await storedConfig(db, termId);
  await db
    .update(terms)
    .set({ rosterConfig: JSON.stringify({ ...config, excludedTitles: titles }) })
    .where(eq(terms.id, termId));
}

/**
 * Save how the term's tracker is read (already cleaned and checked): the
 * sheets, the admin titles and the column names. The excluded titles are saved
 * on their own above and are left as they are.
 */
export async function saveRosterReading(
  db: DbOrTx,
  termId: string,
  reading: RosterReading,
): Promise<void> {
  const config = await storedConfig(db, termId);
  await db
    .update(terms)
    .set({ rosterConfig: JSON.stringify({ ...config, ...reading }) })
    .where(eq(terms.id, termId));
}
