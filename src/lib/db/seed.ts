/**
 * Seed the canonical position + shift-block config into the database.
 * Idempotent upsert — safe to re-run. Invoked via `npm run db:seed`.
 */
import { eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import { positions, shiftBlocks, groups } from "./schema";
import { POSITION_CONFIGS } from "../config/positions";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "../groups/constants";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (see .env.example)");

  const { db, pool } = createDb(url);
  try {
    for (const { position, blocks } of POSITION_CONFIGS) {
      await db
        .insert(positions)
        .values({
          id: position.id,
          name: position.name,
          minHours: position.minHours,
          minDays: position.minDays,
          weekendExempt: position.weekendExempt,
        })
        .onDuplicateKeyUpdate({
          set: {
            name: position.name,
            minHours: position.minHours,
            minDays: position.minDays,
            weekendExempt: position.weekendExempt,
          },
        });

      for (const b of blocks) {
        await db
          .insert(shiftBlocks)
          .values({
            id: b.id,
            positionId: b.positionId,
            dayType: b.dayType,
            startMinutes: b.start,
            endMinutes: b.end,
            highDemand: b.highDemand,
          })
          .onDuplicateKeyUpdate({
            set: {
              startMinutes: b.start,
              endMinutes: b.end,
            },
          });
      }
    }
    // The seeded "New Student" group (PLAN §13). Window left unconfigured (null)
    // so the form stays locked until an admin schedules it. It becomes the
    // default only when no group holds the flag yet — re-seeding never steals
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

    const positionCount = POSITION_CONFIGS.length;
    const blockCount = POSITION_CONFIGS.reduce((n, c) => n + c.blocks.length, 0);
    console.log(
      `Seeded ${positionCount} positions, ${blockCount} shift blocks, and the "${DEFAULT_GROUP_NAME}" default group.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
