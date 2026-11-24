/**
 * Reads and writes a term's roster config (see ./config). Takes a database
 * handle rather than reaching for the app's, so the CLI importer shares it.
 */
import { eq } from "drizzle-orm";
import { appSettings, terms } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/terms/term-id";
import {
  parseRosterConfig,
  type RosterColumns,
  type RosterConfig,
  type RosterReading,
} from "./config";
import { effectiveExcludedTitles, SETTING_EXCLUDED_ROSTER_TITLES } from "./position-mapping";

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
 * Excluded titles have three sources, most specific first: the list saved on
 * the term, the pre-term `excluded_roster_titles` setting (what every install
 * had before terms existed; read until the term saves its own), and the
 * SKIP_TITLES fixture.
 */
export async function loadRosterConfig(db: DbOrTx, termId: string): Promise<EffectiveRosterConfig> {
  const config = await storedConfig(db, termId);
  let excludedTitles: ReadonlySet<string>;
  if (config.excludedTitles !== null) {
    excludedTitles = new Set(config.excludedTitles);
  } else {
    const [legacy] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_EXCLUDED_ROSTER_TITLES))
      .limit(1);
    excludedTitles = effectiveExcludedTitles(legacy?.value ?? null);
  }
  return {
    sheetCandidates: config.sheetCandidates,
    leavingSheet: config.leavingSheet,
    adminTitles: new Set(config.adminTitles),
    excludedTitles,
    columns: config.columns,
  };
}

/**
 * Save the term's excluded titles (already normalized). The pre-term setting is
 * written too, so the previous release still reads the current list if a
 * deploy is rolled back; it goes with the contract migration.
 */
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
  const legacy = titles.join("\n");
  await db
    .insert(appSettings)
    .values({ key: SETTING_EXCLUDED_ROSTER_TITLES, value: legacy })
    .onDuplicateKeyUpdate({ set: { value: legacy } });
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
