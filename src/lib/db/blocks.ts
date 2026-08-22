/**
 * The one definition of "a live shift block".
 *
 * `shift_blocks.retired_at` is set when an admin removes a shift students had
 * already picked: the row survives so those picks keep a time to display (see
 * lib/positions/orphans.ts), but every live read has to filter it out. That
 * filter used to be restated at each call site, and one missed copy readmits a
 * dead shift into a grid, a generated run, or a W2W plan.
 *
 * The few readers that deliberately want retired blocks too (the orphan list,
 * the admin shift editor, the student schedule layout) query without this and
 * say so where they do.
 *
 * It lives here because the form core, the generator, and W2W all need it, and
 * it names a table, so the pure domain can't hold it.
 */
import { isNull } from "drizzle-orm";
import { shiftBlocks } from "./schema";

/** Query filter for live blocks: `.where(liveBlocksOnly())`. */
export function liveBlocksOnly() {
  return isNull(shiftBlocks.retiredAt);
}

/** The same test for a row already read. */
export function isLiveBlock(row: { retiredAt: Date | null }): boolean {
  return row.retiredAt === null;
}
