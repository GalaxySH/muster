/**
 * Seed the initial position + shift-block config and roster title mappings.
 * Insert-only-when-empty: once seeded, the DB is authoritative (admins edit
 * on /admin/positions), so re-running never clobbers admin edits. The default
 * group upsert stays idempotent as before. Invoked via `npm run db:seed`.
 */
import { count, eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import { positions, shiftBlocks, groups, rosterTitleMappings, w2wPositionMap } from "./schema";
import { POSITION_CONFIGS } from "../config/positions";
import { W2W_POSITION_MAP_SEED } from "../w2w/position-map-seed";
import { TITLE_TO_POSITION } from "../roster/position-mapping";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "../groups/constants";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (see .env.example)");

  const { db, pool } = createDb(url);
  try {
    // Positions + blocks: seed only into an empty table, never over admin edits.
    const [positionRow] = await db.select({ n: count() }).from(positions);
    let seededPositions = false;
    if ((positionRow?.n ?? 0) > 0) {
      console.log("position config already present, skipped.");
    } else {
      await db.insert(positions).values(
        POSITION_CONFIGS.map(({ position }) => ({
          id: position.id,
          name: position.name,
          minHours: position.minHours,
          minDays: position.minDays,
          weekendExempt: position.weekendExempt,
        })),
      );
      await db.insert(shiftBlocks).values(
        POSITION_CONFIGS.flatMap(({ blocks }) =>
          blocks.map((b) => ({
            id: b.id,
            positionId: b.positionId,
            dayType: b.dayType,
            startMinutes: b.start,
            endMinutes: b.end,
          })),
        ),
      );
      seededPositions = true;
    }

    // Roster title mappings: same pattern; ghost resolution owns later rows.
    const [mappingRow] = await db.select({ n: count() }).from(rosterTitleMappings);
    let seededMappings = false;
    if ((mappingRow?.n ?? 0) > 0) {
      console.log("title mappings already present, skipped.");
    } else {
      await db
        .insert(rosterTitleMappings)
        .values(
          Object.entries(TITLE_TO_POSITION).map(([title, positionId]) => ({ title, positionId })),
        );
      seededMappings = true;
    }

    // W2W position mapping: insert missing entries only, so a mapping skipped
    // earlier (its Muster position did not exist yet) lands on a later run
    // without ever clobbering an existing row.
    const have = new Set(
      (await db.select({ id: w2wPositionMap.w2wPositionId }).from(w2wPositionMap)).map((r) => r.id),
    );
    const known = new Set((await db.select({ id: positions.id }).from(positions)).map((p) => p.id));
    const rows = W2W_POSITION_MAP_SEED.filter(
      (m) => !have.has(m.w2wPositionId) && known.has(m.musterPositionId),
    );
    if (rows.length > 0) await db.insert(w2wPositionMap).values([...rows]);
    for (const m of W2W_POSITION_MAP_SEED.filter(
      (m) => !have.has(m.w2wPositionId) && !known.has(m.musterPositionId),
    )) {
      console.log(`w2w map: skipped ${m.w2wPositionName} (no position ${m.musterPositionId}).`);
    }
    const seededW2wMap = rows.length;

    // The seeded "New Student" group (PLAN §13). Window left unconfigured (null)
    // so the form stays locked until an admin schedules it. It becomes the
    // default only when no group holds the flag yet; re-seeding never steals
    // the flag back from an admin's setDefaultGroup choice, and an existing row
    // is left untouched entirely (no window/name/flag clobber).
    const [existingDefault] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.isDefault, true))
      .limit(1);
    await db
      .insert(groups)
      .values({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, isDefault: !existingDefault })
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    const seeded: string[] = [];
    if (seededPositions) {
      const blockCount = POSITION_CONFIGS.reduce((n, c) => n + c.blocks.length, 0);
      seeded.push(`${POSITION_CONFIGS.length} positions`, `${blockCount} shift blocks`);
    }
    if (seededMappings) {
      seeded.push(`${Object.keys(TITLE_TO_POSITION).length} title mappings`);
    }
    if (seededW2wMap > 0) {
      seeded.push(`${seededW2wMap} w2w position mappings`);
    }
    seeded.push(`the "${DEFAULT_GROUP_NAME}" default group`);
    console.log(`Seeded ${seeded.join(", ")}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
