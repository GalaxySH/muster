/**
 * DEV ONLY: seed synthetic students with submitted availability so the
 * schedule engine can be tuned and demoed before a real form cycle runs
 * (docs/schedule-generation-plan.md §6).
 *
 *   npm run dev:generate-availability -- --seed 42 [--students 120] [--fill 0.6] [--bias evening]
 *   npm run dev:generate-availability -- --clean
 *
 * Every generated submission passes the real validateAvailability and
 * checkDesiredHours gates, so fixtures are always legal. Deterministic from
 * --seed: the same seed against the same block config produces the same rows.
 * Students are created as synthetic-NNN@wisc.edu and removed by --clean; the
 * script refuses to run in production. Travel rows and evidence files are not
 * generated (they would point at Drive files that don't exist).
 */
import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { positions, shiftBlocks, shiftSelections, students, submissions } from "../lib/db/schema";
import { liveBlocksOnly } from "../lib/db/blocks";
import { toDomainBlock, toDomainPosition } from "../lib/db/mappers";
import { deriveOpenClose } from "../lib/domain/blocks";
import { EVENING_END_MINUTES } from "../lib/domain/scheduling/coverage";
import { checkDesiredHours, validateAvailability } from "../lib/domain/validation";
import {
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  type Day,
  type Position,
  type SelectedShift,
  type ShiftBlock,
} from "../lib/domain/types";

const EMAIL_PREFIX = "synthetic-";
const EMAIL_PATTERN = `${EMAIL_PREFIX}%@wisc.edu`;
/** Fixed response-window start; submittedAt staggers from here per student. */
const WINDOW_START = Date.UTC(2026, 7, 1, 9, 0, 0);

type Bias = "none" | "evening" | "morning";

function parseArgs(argv: string[]) {
  let seed = 42;
  let count = 120;
  let fill = 0.6;
  let bias: Bias = "none";
  let clean = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed") seed = Number(argv[++i]);
    else if (arg === "--students") count = Number(argv[++i]);
    else if (arg === "--fill") fill = Number(argv[++i]);
    else if (arg === "--bias") bias = argv[++i] as Bias;
    else if (arg === "--clean") clean = true;
    else throw new Error(`Unknown argument "${arg}"`);
  }
  if (!Number.isFinite(seed) || !Number.isInteger(count) || count < 1 || count > 2000) {
    throw new Error("Bad --seed or --students value");
  }
  if (!(fill > 0 && fill <= 1)) throw new Error("--fill must be in (0, 1]");
  if (!["none", "evening", "morning"].includes(bias)) {
    throw new Error('--bias must be "evening", "morning", or "none"');
  }
  return { seed, count, fill, bias, clean };
}

/** Small deterministic PRNG (mulberry32); good enough for fixture variety. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blockProbability(block: ShiftBlock, fill: number, bias: Bias): number {
  if (bias === "none") return fill;
  const late = block.end >= EVENING_END_MINUTES;
  const boosted = Math.min(1, fill * 1.4);
  const damped = fill * 0.5;
  return bias === "evening" ? (late ? boosted : damped) : late ? damped : boosted;
}

interface Generated {
  email: string;
  displayName: string;
  position: Position;
  international: boolean;
  everyWeekendOptIn: boolean;
  desiredHours: number;
  submittedAt: Date;
  selection: SelectedShift[];
}

function generateStudent(
  index: number,
  position: Position,
  blocks: ShiftBlock[],
  rng: () => number,
  fill: number,
  bias: Bias,
): Generated {
  const weekdayBlocks = blocks.filter((b) => b.dayType === "weekday");
  const weekendBlocks = blocks.filter((b) => b.dayType === "weekend");

  const everyWeekendOptIn = !position.weekendExempt && weekendBlocks.length > 0 && rng() < 0.15;
  const international = rng() < 0.12;
  const desiredHours = position.minHours + Math.floor(rng() * 14);

  // Pick the days offered: at least the position minimum, usually a few more,
  // and one weekend day for non-exempt positions (mirroring the real rule that
  // everyone lands on the rotation).
  const days: Day[] = [];
  if (!position.weekendExempt && weekendBlocks.length > 0) {
    days.push(rng() < 0.5 ? "sat" : "sun");
    if (rng() < 0.3) days.push(days[0] === "sat" ? "sun" : "sat");
  }
  const weekdayPool = [...WEEKDAY_DAYS];
  const weekdayCount = Math.min(
    weekdayPool.length,
    Math.max(position.minDays - days.length, 1) + Math.floor(rng() * 3 * fill + 1),
  );
  for (let i = 0; i < weekdayCount; i++) {
    const pick = Math.floor(rng() * weekdayPool.length);
    days.push(weekdayPool.splice(pick, 1)[0]!);
  }

  const selection: SelectedShift[] = [];
  const has = (cell: SelectedShift) =>
    selection.some((s) => s.blockId === cell.blockId && s.day === cell.day);
  const add = (cell: SelectedShift) => {
    if (!has(cell)) selection.push(cell);
  };
  for (const day of days) {
    const pool = WEEKDAY_DAYS.includes(day) ? weekdayBlocks : weekendBlocks;
    const chosen = pool.filter((b) => rng() < blockProbability(b, fill, bias));
    for (const b of chosen) add({ blockId: b.id, day });
    if (!pool.some((b) => chosen.includes(b)) && pool.length > 0) {
      add({ blockId: pool[Math.floor(rng() * pool.length)]!.id, day });
    }
  }

  // Repair until the real hard rules pass: an open-or-close cell, then more
  // cells (and days if needed) until the minimum hours are reachable.
  const repairPool: SelectedShift[] = [];
  for (const day of [...WEEKDAY_DAYS, ...WEEKEND_DAYS]) {
    const pool = WEEKDAY_DAYS.includes(day) ? weekdayBlocks : weekendBlocks;
    for (const b of pool) repairPool.push({ blockId: b.id, day });
  }
  for (let guard = 0; guard < repairPool.length + 8; guard++) {
    const v = validateAvailability(selection, position, blocks, { everyWeekendOptIn });
    if (v.canSubmit) break;
    const failing = v.checks.find((c) => c.severity === "hard" && !c.passed)!;
    if (failing.id === "open_or_close") {
      const { openId, closeId } = deriveOpenClose(weekdayBlocks);
      const anchor = closeId ?? openId ?? deriveOpenClose(weekendBlocks).closeId;
      if (!anchor) throw new Error(`Position ${position.id} has no derivable open or close block`);
      const anchorBlock = blocks.find((b) => b.id === anchor)!;
      const day =
        days.find((d) =>
          anchorBlock.dayType === "weekend" ? !WEEKDAY_DAYS.includes(d) : WEEKDAY_DAYS.includes(d),
        ) ?? (anchorBlock.dayType === "weekend" ? "sat" : "mon");
      add({ blockId: anchor, day });
      continue;
    }
    const next = repairPool.find((cell) => !has(cell));
    if (!next) throw new Error(`Cannot make a valid selection for position ${position.id}`);
    add(next);
  }
  const finalCheck = validateAvailability(selection, position, blocks, { everyWeekendOptIn });
  const desiredCheck = checkDesiredHours(desiredHours, position);
  if (!finalCheck.canSubmit || !desiredCheck.passed) {
    throw new Error(`Generated an invalid submission for position ${position.id}`);
  }

  const n = String(index + 1).padStart(3, "0");
  return {
    email: `${EMAIL_PREFIX}${n}@wisc.edu`,
    displayName: `Synthetic Student ${n}`,
    position,
    international,
    everyWeekendOptIn,
    desiredHours,
    submittedAt: new Date(WINDOW_START + index * 137_000),
    selection,
  };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to generate synthetic data in production");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (see .env.example)");
  const args = parseArgs(process.argv.slice(2));

  const { db, pool } = createDb(url);
  try {
    const existing = await db
      .select({ email: students.email })
      .from(students)
      .where(like(students.email, EMAIL_PATTERN));
    if (args.clean) {
      if (existing.length > 0) {
        const emails = existing.map((r) => r.email);
        await db.delete(submissions).where(inArray(submissions.studentEmail, emails));
        await db.delete(students).where(inArray(students.email, emails));
      }
      console.log(`✓ Removed ${existing.length} synthetic students and their submissions.`);
      return;
    }
    if (existing.length > 0) {
      throw new Error(
        `${existing.length} synthetic students already exist. Run with --clean first.`,
      );
    }

    const posRows = await db.select().from(positions);
    const blockRows = await db.select().from(shiftBlocks).where(liveBlocksOnly());
    const allBlocks = blockRows.map(toDomainBlock);
    const usable = posRows
      .filter((p) => p.active && p.mergedIntoId === null)
      .map(toDomainPosition)
      .filter((p) => allBlocks.some((b) => b.positionId === p.id && b.dayType === "weekday"))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (usable.length === 0) throw new Error("No active positions with blocks; seed the DB first");

    const rng = mulberry32(args.seed);
    const generated: Generated[] = [];
    for (let i = 0; i < args.count; i++) {
      const position = usable[i % usable.length]!;
      const blocks = allBlocks.filter((b) => b.positionId === position.id);
      generated.push(generateStudent(i, position, blocks, rng, args.fill, args.bias));
    }

    for (const g of generated) {
      await db.insert(students).values({
        email: g.email,
        displayName: g.displayName,
        positionId: g.position.id,
        international: g.international,
        onRoster: true,
      });
      const submissionId = randomUUID();
      await db.insert(submissions).values({
        id: submissionId,
        studentEmail: g.email,
        status: "submitted",
        everyWeekendOptIn: g.everyWeekendOptIn,
        desiredHours: g.desiredHours,
        confirmedAt: g.submittedAt,
        submittedAt: g.submittedAt,
      });
      await db.insert(shiftSelections).values(
        g.selection.map((cell) => ({
          submissionId,
          shiftBlockId: cell.blockId,
          day: cell.day,
          autoAssigned: false,
        })),
      );
    }

    const cells = generated.reduce((sum, g) => sum + g.selection.length, 0);
    console.log(
      `✓ Created ${generated.length} synthetic students (${cells} selection cells, seed ${args.seed}, fill ${args.fill}, bias ${args.bias}).`,
    );
    console.log("  Remove them any time with: npm run dev:generate-availability -- --clean");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
