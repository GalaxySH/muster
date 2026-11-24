/**
 * Which term (semester) the app is running in (docs/semester-domains-plan.md).
 *
 * One pointer, the `current_term_id` row in app_settings, names it. This module
 * is a shared root like lib/db: the form core, the generator, W2W and the
 * console all read it, and it imports none of them. It is plain (no
 * `server-only`) because the roster import and the dev scripts run from the CLI.
 *
 * The request-side wrappers are `currentTermId()` and `workingTermId()` in ./working.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { appSettings, terms } from "@/lib/db/schema";

export const SETTING_CURRENT_TERM_ID = "current_term_id";

/**
 * WHERE test, true only when `termId` is the current term. The retired columns
 * on `students` mirror the current term's roster and groups and nothing else,
 * so a write to an earlier term must leave them alone. It is tested in SQL so
 * that a transaction body gains no read.
 */
export const isCurrentTermSql = (termId: string) =>
  sql`${termId} = (select ${appSettings.value} from ${appSettings} where ${appSettings.key} = ${SETTING_CURRENT_TERM_ID})`;

/** A database handle or an open transaction on one. */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The current term's id. There is no default term anywhere in the code: this
 * throws when the pointer is missing, blank, or names a term that does not
 * exist, so a broken install fails closed. Nothing may ever fall back to
 * another term or to reading every term.
 *
 * The join is what catches a dangling pointer. Without it the id would come
 * back fine and every list would simply read empty.
 */
export async function getCurrentTermId(db: DbOrTx): Promise<string> {
  const [row] = await db
    .select({ id: terms.id })
    .from(appSettings)
    .innerJoin(terms, eq(terms.id, appSettings.value))
    .where(eq(appSettings.key, SETTING_CURRENT_TERM_ID))
    .limit(1);
  if (!row?.id) {
    throw new Error(
      "No current term: app_settings.current_term_id is missing or names a term that does not exist.",
    );
  }
  return row.id;
}
