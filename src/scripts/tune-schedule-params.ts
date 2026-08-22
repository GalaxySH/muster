/**
 * Tuning harness for the schedule engine's admin knobs
 * (docs/generator-constraints-fairness-plan.md §7, phase P5).
 *
 *   npm run dev:tune-params -- --snapshot <path-to-export.json>
 *   npm run dev:tune-params                # seeded synthetic population
 *   npm run dev:tune-params -- --anneal 300000   # sweep with the optimizer too
 *
 * Sweeps `repeatStartPenalty` over a fixed ladder, runs the PURE engine path
 * for each value, and prints one table row per value.
 *
 * `--anneal <rounds>` sweeps the whole ladder a SECOND time with the annealing
 * pass on at that round count, and prints both tables and both verdicts. The
 * shipped default was tuned before that pass existed, and the pass moves the
 * same numbers the decision rule reads, so the value that wins with the
 * optimizer off is not automatically the value that wins with it on. The
 * optimizer-on verdict is the one the shipped default follows; the off table
 * is there to show whether the two agree. Nothing here touches a
 * database or a server action: it calls `generateAssignments` (which runs the
 * improvement pass itself) exactly the way `schedule/actions.ts` does, so the
 * numbers describe a real generation without needing one.
 *
 * Two populations, the same code path for both:
 *
 * - `--snapshot` reads a read-only production export (DB-shaped tables, every
 *   value a string the way a mysql dump hands them over). That file holds
 *   student emails, so it lives OUTSIDE the repo, is never copied in, and
 *   nothing this script prints is per-student: the table is aggregate counts,
 *   shares, and distributions only.
 * - Without the flag it builds a seeded synthetic population over the repo's
 *   own initial block config (`lib/config/positions.ts`). That path needs no
 *   snapshot and no DB, so CI can run it. It mirrors the student construction
 *   in `generate-availability.ts` (same mulberry32, same day and block draws,
 *   same repair loop through the real `validateAvailability`); that script's
 *   helpers are not exported and this phase does not modify it, so the mirror
 *   is deliberate rather than shared.
 *
 * Determinism is checked, not assumed: every penalty runs TWICE and the two
 * runs' assignments and reports are compared before either is reported. If any
 * pair differs the script exits NON-ZERO and chooses no value: the table still
 * prints, marked untrustworthy, but a sweep that cannot reproduce itself is not
 * evidence for a default.
 */
import { readFileSync } from "node:fs";
import { applyInternalOverrides, type InternalCopy } from "../lib/availability/effective";
import { POSITIONS, SHIFT_BLOCKS } from "../lib/config/positions";
import { toDomainBlock, toDomainPosition } from "../lib/db/mappers";
import type { positions as positionsTable, shiftBlocks as blocksTable } from "../lib/db/schema";
import { deriveOpenClose } from "../lib/domain/blocks";
import { SHIFT_LEAD_POSITION_ID } from "../lib/domain/close-claims";
import { EVENING_END_MINUTES } from "../lib/domain/scheduling/coverage";
import { generateAssignments } from "../lib/domain/scheduling/engine";
import { DEFAULT_SCHEDULING_PARAMS } from "../lib/domain/scheduling/params";
import { computeRunStats, type RunStats } from "../lib/domain/scheduling/stats";
import type { EngineReport, ScheduleStudent } from "../lib/domain/scheduling/types";
import {
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  type Day,
  type Position,
  type SelectedShift,
  type ShiftBlock,
} from "../lib/domain/types";
import { checkDesiredHours, validateAvailability } from "../lib/domain/validation";
import { isReturningStudent } from "../lib/flow/returner";

type PositionRow = typeof positionsTable.$inferSelect;
type ShiftBlockRow = typeof blocksTable.$inferSelect;

/** The ladder the plan settled on. Every other knob stays at its default. */
const PENALTIES = [0, 2, 5, 10, 20] as const;

/**
 * Fixed clock for returner resolution. `generateSchedule` uses `new Date()`;
 * pinning it here is what keeps a tuning table reproducible months later, since
 * returner status flips on June 1 and reorders the whole run.
 */
const TUNING_NOW = new Date(Date.UTC(2026, 7, 19));

type Bias = "none" | "evening" | "morning";

interface Args {
  snapshot: string | null;
  seed: number;
  count: number;
  fill: number;
  bias: Bias;
  /** Annealing rounds for the second pass over the ladder; 0 sweeps once. */
  anneal: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { snapshot: null, seed: 42, count: 400, fill: 0.8, bias: "none", anneal: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--snapshot") args.snapshot = argv[++i] ?? null;
    else if (arg === "--seed") args.seed = Number(argv[++i]);
    else if (arg === "--students") args.count = Number(argv[++i]);
    else if (arg === "--fill") args.fill = Number(argv[++i]);
    else if (arg === "--bias") args.bias = argv[++i] as Bias;
    else if (arg === "--anneal") args.anneal = Number(argv[++i]);
    else throw new Error(`Unknown argument "${arg}"`);
  }
  if (args.snapshot !== null && args.snapshot.trim() === "") {
    throw new Error("--snapshot needs a path");
  }
  if (!Number.isFinite(args.seed) || !Number.isInteger(args.count) || args.count < 1) {
    throw new Error("Bad --seed or --students value");
  }
  if (!(args.fill > 0 && args.fill <= 1)) throw new Error("--fill must be in (0, 1]");
  if (!Number.isInteger(args.anneal) || args.anneal < 0) {
    throw new Error("--anneal must be a whole number of rounds, 0 or more");
  }
  if (!["none", "evening", "morning"].includes(args.bias)) {
    throw new Error('--bias must be "evening", "morning", or "none"');
  }
  return args;
}

/** The population one sweep runs against, however it was built. */
interface Population {
  /** Printed above the table so a pasted result always says what it measured. */
  label: string;
  students: ScheduleStudent[];
  positions: Position[];
  blocks: ShiftBlock[];
}

// ---------------------------------------------------------------------------
// Snapshot population
// ---------------------------------------------------------------------------

/**
 * The export's tables, as JSON hands them over: every column a string (or null),
 * because a mysql dump does not carry column types. The mapping below is the
 * only place that knows this, so the rest of the script sees domain values.
 */
interface SnapshotTables {
  positions: SnapshotRow[];
  shift_blocks: SnapshotRow[];
  students: SnapshotRow[];
  submissions: SnapshotRow[];
  shift_selections: SnapshotRow[];
  internal_availability: SnapshotRow[];
  internal_selections: SnapshotRow[];
}

/**
 * One exported row. Indexing it yields `undefined` for a column the export did
 * not carry, which every reader below treats exactly like SQL NULL: a column
 * that is absent and one that is null are the same amount of information.
 */
type SnapshotRow = Record<string, string | null>;
type Cell = string | null | undefined;

const str = (v: Cell): string => v ?? "";
const strOrNull = (v: Cell): string | null => v ?? null;
const num = (v: Cell): number => Number(v ?? 0);
const numOrNull = (v: Cell): number | null => (v === null || v === undefined ? null : Number(v));
/** MySQL tinyint(1) comes back as "1"/"0". */
const bool = (v: Cell): boolean => v === "1";

/**
 * A `date` column as the app sees it. The mysql2 driver builds LOCAL midnight
 * for a date, so this rebuilds the same value rather than parsing the ISO
 * string (which would land UTC midnight and shift the day west of UTC). Reading
 * it the driver's way is what makes `isReturningStudent` agree with production.
 */
function localDate(v: Cell): Date | null {
  if (!v) return null;
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** A `datetime` column, likewise local: it is only ever an FCFS sort key here. */
function localDateTime(v: Cell): Date | null {
  if (!v) return null;
  const parsed = new Date(v.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Map the export the way `generateSchedule` maps the live tables:
 * eligibility is on-roster AND submitted (`eligibleSubmittedFilter`), retired
 * blocks never enter a run, picks on a block that is gone are dropped before
 * anything reads them, and an admin's internal copy replaces the student's own
 * selection wholesale (`applyInternalOverrides`). Non-responders are left out,
 * matching the default `includeNonResponders: false`.
 */
function snapshotPopulation(path: string): Population {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    exportedAt?: string;
    tables: SnapshotTables;
  };
  const t = raw.tables;

  const positionRows: PositionRow[] = t.positions.map((r) => ({
    id: str(r.id),
    name: str(r.name),
    minHours: num(r.min_hours),
    minDays: num(r.min_days),
    weekendExempt: bool(r.weekend_exempt),
    active: bool(r.active),
    mergedIntoId: strOrNull(r.merged_into_id),
    returnDate: strOrNull(r.return_date),
  }));

  // Retired blocks never enter a run (actions.ts filters them in SQL).
  const blockRows: ShiftBlockRow[] = t.shift_blocks
    .filter((r) => strOrNull(r.retired_at) === null)
    .map((r) => ({
      id: str(r.id),
      positionId: str(r.position_id),
      dayType: str(r.day_type) as ShiftBlockRow["dayType"],
      startMinutes: num(r.start_minutes),
      endMinutes: num(r.end_minutes),
      desiredCapacity: numOrNull(r.desired_capacity),
      retiredAt: null,
    }));

  const blocks = blockRows.map(toDomainBlock);
  const liveBlockIds = new Set(blocks.map((b) => b.id));

  const studentByEmail = new Map(t.students.map((r) => [str(r.email), r]));

  // Eligible = on roster and submitted, the exact join actions.ts runs.
  const eligible = t.submissions.filter((s) => {
    const student = studentByEmail.get(str(s.student_email));
    return str(s.status) === "submitted" && student !== undefined && bool(student.on_roster);
  });
  const submissionEmail = new Map(eligible.map((s) => [str(s.id), str(s.student_email)]));

  const selectionByEmail = new Map<string, SelectedShift[]>();
  for (const row of t.shift_selections) {
    const email = submissionEmail.get(str(row.submission_id));
    if (email === undefined) continue;
    const blockId = str(row.shift_block_id);
    if (!liveBlockIds.has(blockId)) continue;
    const list = selectionByEmail.get(email) ?? [];
    list.push({ blockId, day: str(row.day) as Day });
    selectionByEmail.set(email, list);
  }

  // Internal copies win over the student's own answers (PLAN §10a), and get the
  // same dead-cell filtering, since a copy replaces a selection wholesale.
  const internalCellsBySubmission = new Map<string, SelectedShift[]>();
  for (const row of t.internal_selections) {
    const blockId = str(row.shift_block_id);
    if (!liveBlockIds.has(blockId)) continue;
    const list = internalCellsBySubmission.get(str(row.submission_id)) ?? [];
    list.push({ blockId, day: str(row.day) as Day });
    internalCellsBySubmission.set(str(row.submission_id), list);
  }
  const internalByEmail = new Map<string, InternalCopy>();
  for (const row of t.internal_availability) {
    const submissionId = str(row.submission_id);
    const email = submissionEmail.get(submissionId);
    if (email === undefined) continue;
    internalByEmail.set(email, {
      everyWeekendOptIn: bool(row.every_weekend_opt_in),
      selection: internalCellsBySubmission.get(submissionId) ?? [],
    });
  }

  const students = applyInternalOverrides(
    eligible.map((s) => {
      const email = str(s.student_email);
      const student = studentByEmail.get(email)!;
      return {
        email,
        positionId: strOrNull(student.position_id),
        international: bool(student.international),
        everyWeekendOptIn: bool(s.every_weekend_opt_in),
        desiredHours: numOrNull(s.desired_hours),
        submittedAt: localDateTime(s.submitted_at),
        scheduled: bool(s.scheduled),
        returner: isReturningStudent(localDate(student.hired_on), TUNING_NOW),
        selection: selectionByEmail.get(email) ?? [],
      } satisfies ScheduleStudent;
    }),
    internalByEmail,
  );

  const frozen = students.filter((s) => s.scheduled).length;
  return {
    label:
      `production snapshot ${raw.exportedAt ?? "(undated)"}: ${students.length} eligible students, ` +
      `${blocks.length} live blocks, ${positionRows.length} positions, ` +
      `${internalByEmail.size} internal copies, ${frozen} frozen`,
    students,
    positions: positionRows.map(toDomainPosition),
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Synthetic population (no snapshot, no DB)
// ---------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32), same one generate-availability.ts uses. */
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

/**
 * The seed fixture declares no targets (they are admin-set per block), and an
 * engine with no targets anywhere fills nothing preferentially, which would
 * make the sweep meaningless. So the synthetic path derives a target per block
 * from the population size: enough seats to be contended, never so many that
 * every cell stays hungry. Deterministic, and the snapshot path never uses it.
 */
function syntheticCapacity(count: number, positionCount: number): number {
  return Math.max(2, Math.round(count / (positionCount * 8)));
}

/**
 * One student's availability, mirroring `generateStudent` in
 * generate-availability.ts: a weekend day for non-exempt positions, a handful
 * of weekday days, blocks drawn per the fill probability, then repaired against
 * the REAL hard rules until the submission would be legal.
 */
function syntheticSelection(
  position: Position,
  blocks: ShiftBlock[],
  rng: () => number,
  fill: number,
  bias: Bias,
  everyWeekendOptIn: boolean,
): SelectedShift[] {
  const weekdayBlocks = blocks.filter((b) => b.dayType === "weekday");
  const weekendBlocks = blocks.filter((b) => b.dayType === "weekend");

  const days: Day[] = [];
  if (!position.weekendExempt && weekendBlocks.length > 0) {
    days.push(rng() < 0.5 ? "sat" : "sun");
    if (rng() < 0.3) days.push(days[0] === "sat" ? "sun" : "sat");
  }
  const weekdayPool: Day[] = [...WEEKDAY_DAYS];
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
    const pool = (WEEKDAY_DAYS as readonly Day[]).includes(day) ? weekdayBlocks : weekendBlocks;
    const chosen = pool.filter((b) => rng() < blockProbability(b, fill, bias));
    for (const b of chosen) add({ blockId: b.id, day });
    if (chosen.length === 0 && pool.length > 0) {
      add({ blockId: pool[Math.floor(rng() * pool.length)]!.id, day });
    }
  }

  const repairPool: SelectedShift[] = [];
  for (const day of [...WEEKDAY_DAYS, ...WEEKEND_DAYS] as Day[]) {
    const pool = (WEEKDAY_DAYS as readonly Day[]).includes(day) ? weekdayBlocks : weekendBlocks;
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
          anchorBlock.dayType === "weekend"
            ? !(WEEKDAY_DAYS as readonly Day[]).includes(d)
            : (WEEKDAY_DAYS as readonly Day[]).includes(d),
        ) ?? (anchorBlock.dayType === "weekend" ? "sat" : "mon");
      add({ blockId: anchor, day });
      continue;
    }
    const next = repairPool.find((cell) => !has(cell));
    if (!next) throw new Error(`Cannot make a valid selection for position ${position.id}`);
    add(next);
  }
  return selection;
}

/** Fixed response-window start; submittedAt staggers from here, as in the seeder. */
const WINDOW_START = Date.UTC(2026, 7, 1, 9, 0, 0);

function syntheticPopulation(args: Args): Population {
  const usable = POSITIONS.filter((p) => SHIFT_BLOCKS.some((b) => b.positionId === p.id));
  const capacity = syntheticCapacity(args.count, usable.length);
  const blocks: ShiftBlock[] = SHIFT_BLOCKS.map((b) => ({ ...b, desiredCapacity: capacity }));

  const rng = mulberry32(args.seed);
  const students: ScheduleStudent[] = [];
  for (let i = 0; i < args.count; i++) {
    const position = usable[i % usable.length]!;
    const positionBlocks = blocks.filter((b) => b.positionId === position.id);
    const weekendBlocks = positionBlocks.filter((b) => b.dayType === "weekend");
    const everyWeekendOptIn = !position.weekendExempt && weekendBlocks.length > 0 && rng() < 0.15;
    const international = rng() < 0.12;
    const desiredHours = position.minHours + Math.floor(rng() * 14);
    const selection = syntheticSelection(
      position,
      positionBlocks,
      rng,
      args.fill,
      args.bias,
      everyWeekendOptIn,
    );
    if (!checkDesiredHours(desiredHours, position).passed) {
      throw new Error(`Generated an invalid desired-hours value for position ${position.id}`);
    }
    // Every third student is a returner, so the ordering and the fragility
    // metrics both have something to measure. Deterministic, not drawn.
    students.push({
      email: `synthetic-${String(i + 1).padStart(3, "0")}@wisc.edu`,
      positionId: position.id,
      international,
      everyWeekendOptIn,
      desiredHours,
      submittedAt: new Date(WINDOW_START + i * 137_000),
      scheduled: false,
      returner: i % 3 === 0,
      selection,
    });
  }

  return {
    label:
      `synthetic population: ${students.length} students, seed ${args.seed}, fill ${args.fill}, ` +
      `bias ${args.bias}, ${blocks.length} blocks at target ${capacity}`,
    students,
    positions: [...POSITIONS],
    blocks,
  };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/** Shift Lead weekend closes come last, exactly as `generateSchedule` passes them. */
function deferredBlockIds(blocks: readonly ShiftBlock[]): string[] {
  const weekend = blocks.filter(
    (b) => b.positionId === SHIFT_LEAD_POSITION_ID && b.dayType === "weekend",
  );
  const { closeId } = deriveOpenClose(weekend);
  return closeId ? [closeId] : [];
}

interface RunOutcome {
  /** Assignment rows. Context only: the optimizer trims above-target hours by
   *  design, so this falls while the seats that are actually asked for rise. */
  seats: number;
  /** Graded targeted fill, the number every admin surface reports. */
  filled: number;
  report: EngineReport;
  stats: RunStats;
  ms: number;
  /** Assignments and report as one string, for the determinism comparison. */
  fingerprint: string;
}

function runOnce(pop: Population, penalty: number, annealRounds: number): RunOutcome {
  const params = {
    ...DEFAULT_SCHEDULING_PARAMS,
    repeatStartPenalty: penalty,
    annealIterations: annealRounds,
  };
  const started = performance.now();
  const result = generateAssignments({
    students: pop.students,
    positions: pop.positions,
    blocks: pop.blocks,
    previous: [],
    params,
    deferredBlockIds: deferredBlockIds(pop.blocks),
  });
  const ms = performance.now() - started;

  const frozenEmails = new Set(result.report.students.filter((s) => s.frozen).map((s) => s.email));
  const stats = computeRunStats({
    assignments: result.assignments,
    blocks: pop.blocks,
    students: pop.students.map((s) => ({
      email: s.email,
      positionId: s.positionId,
      international: s.international,
      everyWeekendOptIn: s.everyWeekendOptIn,
      returner: s.returner === true,
      fillIn: s.fillIn === true,
      frozen: frozenEmails.has(s.email),
    })),
    poolPositionIds: params.coveragePoolPositionIds,
    leadPositionId: SHIFT_LEAD_POSITION_ID,
    maxConsecutiveDays: params.maxConsecutiveDays,
  });

  return {
    seats: result.assignments.length,
    filled: stats.positions.reduce((sum, p) => sum + p.filledOfTarget, 0),
    report: result.report,
    stats,
    ms,
    fingerprint: JSON.stringify({ a: result.assignments, r: result.report }),
  };
}

/** One table row: everything the decision rule reads, plus context. */
interface Row {
  penalty: number;
  seats: number;
  filled: number;
  shortOfTarget: number;
  belowMinHours: number;
  modalStartShare: number;
  welded: number;
  lockstepGroups: number;
  lockstepPeople: number;
  spread: number;
  pstdev: number;
  ms: number;
  deterministic: boolean;
}

const pad = (s: string, width: number) => s.padStart(width);

function printTable(rows: readonly Row[]): void {
  const headers = [
    ["penalty", 7],
    ["seats", 6],
    ["filled", 6],
    ["short", 6],
    ["belowMin", 8],
    ["modalStart", 10],
    ["welded", 6],
    ["lockGrp", 7],
    ["lockPpl", 7],
    ["spread", 7],
    ["pstdev", 7],
    ["ms", 6],
  ] as const;
  console.log(headers.map(([h, w]) => pad(h, w)).join("  "));
  console.log(headers.map(([, w]) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(
      [
        pad(String(r.penalty), 7),
        pad(String(r.seats), 6),
        pad(String(r.filled), 6),
        pad(String(r.shortOfTarget), 6),
        pad(String(r.belowMinHours), 8),
        pad(r.modalStartShare.toFixed(4), 10),
        pad(String(r.welded), 6),
        pad(String(r.lockstepGroups), 7),
        pad(String(r.lockstepPeople), 7),
        pad(r.spread.toFixed(1), 7),
        pad(r.pstdev.toFixed(1), 7),
        pad(r.ms.toFixed(0), 6),
      ].join("  "),
    );
  }
}

/**
 * The flip rule, applied mechanically so the choice is auditable rather than
 * argued: the smallest penalty that improves at least two of the four fairness
 * metrics by a meaningful margin (better than 2% relative, or by more than 1
 * where the metric is a count of people), while GRADED targeted fill falls by
 * no more than 0.5% relative and neither shortfall counter rises.
 *
 * The guard reads graded fill rather than the raw assignment count it used to.
 * Graded fill is what every admin surface reports and what the optimizer
 * optimizes. Raw rows also count seats that fill nothing: a row landing in a
 * cell already at its target, or on the fuller of a weekend cell two rotation
 * weeks. And the two part company outright once the optimizer is on, since it
 * trims hours above target on purpose, dropping rows while raising the seats
 * anyone actually asked for; judged on rows, the rule would penalize the pass
 * for doing its job.
 *
 * This changes what the rule says on one of the two populations, so it is
 * recorded rather than glossed. On the SYNTHETIC population penalty 20 still
 * qualifies outright, on all four fairness metrics, losing 0.16% of graded
 * fill. On the 2026-08-20 production SNAPSHOT it no longer does: it adds 6
 * rows over penalty 0 but LOSES 4 graded seats (708 to 704, 0.56%), just past
 * the cap, where the row count had it gaining 0.72% and passing. Nothing else
 * on the ladder qualifies on the snapshot under either optimizer setting, and
 * "nothing qualified" leaves the shipped 20 where it is, so the value does not
 * move either way.
 */
const MEANINGFUL_RELATIVE = 0.02;
const MEANINGFUL_ABSOLUTE = 1;
const SEAT_LOSS_LIMIT = 0.005;

interface MetricVerdict {
  name: string;
  base: number;
  value: number;
  /** Every metric here is better when lower. */
  relative: number;
  improved: boolean;
}

/**
 * Known small-count fragility, stated so a re-run on a different roster weighs
 * it: because the two branches are OR'd, a COUNT metric moving by a single
 * person can still qualify through the >2% relative branch, which is exactly
 * what the >1-person absolute branch was written to reject. One person out of a
 * base of 5 reads as 20% (production's `welded` 5 to 4 scored precisely that).
 * The smaller the baseline count, the more a one-person swing is flattered.
 */
function judgeMetric(name: string, base: number, value: number, isCount: boolean): MetricVerdict {
  const relative = base === 0 ? 0 : (base - value) / base;
  const improved =
    relative > MEANINGFUL_RELATIVE || (isCount && base - value > MEANINGFUL_ABSOLUTE);
  return { name, base, value, relative, improved };
}

function evaluate(rows: readonly Row[], trustworthy: boolean): number | null {
  const base = rows[0]!;
  console.log("");
  console.log(`Decision rule against penalty ${base.penalty} as the baseline.`);
  console.log("Qualifies when >= 2 of {modalStart, welded, lockstep people, spread} improve by");
  console.log("  >2% relative (or by >1 person for the counts), graded fill falls <= 0.5%,");
  console.log("  and neither shortOfTarget nor belowMinHours rises.");
  console.log("");

  let chosen: number | null = null;
  for (const row of rows.slice(1)) {
    const metrics = [
      judgeMetric("modalStart", base.modalStartShare, row.modalStartShare, false),
      judgeMetric("welded", base.welded, row.welded, true),
      judgeMetric("lockstepPeople", base.lockstepPeople, row.lockstepPeople, true),
      judgeMetric("spread", base.spread, row.spread, false),
    ];
    const improvedCount = metrics.filter((m) => m.improved).length;
    const seatLoss = base.filled === 0 ? 0 : (base.filled - row.filled) / base.filled;
    const seatsOk = seatLoss <= SEAT_LOSS_LIMIT;
    const shortfallOk =
      row.shortOfTarget <= base.shortOfTarget && row.belowMinHours <= base.belowMinHours;
    const qualifies = improvedCount >= 2 && seatsOk && shortfallOk;

    console.log(`penalty ${row.penalty}:`);
    for (const m of metrics) {
      console.log(
        `  ${m.name.padEnd(15)} ${m.base} -> ${m.value}` +
          `  (${(m.relative * 100).toFixed(1)}% better)  ${m.improved ? "MEANINGFUL" : "not meaningful"}`,
      );
    }
    console.log(`  improved metrics ${improvedCount} of 4 (need 2)`);
    console.log(
      `  filled ${base.filled} -> ${row.filled} ` +
        `(${seatLoss >= 0 ? `${(seatLoss * 100).toFixed(2)}% lost` : `${(-seatLoss * 100).toFixed(2)}% gained`}` +
        `, loss cap 0.50%) ${seatsOk ? "ok" : "FAILS"}`,
    );
    console.log(
      `  shortOfTarget ${base.shortOfTarget} -> ${row.shortOfTarget}, ` +
        `belowMinHours ${base.belowMinHours} -> ${row.belowMinHours} ${shortfallOk ? "ok" : "FAILS"}`,
    );
    console.log(`  => ${qualifies ? "QUALIFIES" : "does not qualify"}`);
    if (qualifies && chosen === null) chosen = row.penalty;
  }

  console.log("");
  if (!trustworthy) {
    // A sweep that cannot reproduce itself cannot choose anything, so the
    // verdict line is withheld rather than printed with a caveat beside it.
    console.log("NO VALUE CHOSEN: at least one penalty differed between its two runs, so");
    console.log("the table above decides nothing. Fix the nondeterminism and re-run.");
  } else if (chosen === null) {
    console.log(
      `No penalty qualified against the sweep baseline ${base.penalty}. ` +
        `repeatStartPenalty stays at its shipped default, ` +
        `${DEFAULT_SCHEDULING_PARAMS.repeatStartPenalty}.`,
    );
  } else {
    console.log(
      `Chosen repeatStartPenalty: ${chosen} ` +
        `(smallest qualifying value on the swept ladder ${PENALTIES.join(", ")}).`,
    );
  }
  return chosen;
}

/**
 * One full pass over the ladder at one optimizer setting: every penalty run
 * twice, the table, and the decision rule. Returns what it chose so a caller
 * running both settings can say whether they agree.
 */
function sweep(
  pop: Population,
  annealRounds: number,
): { chosen: number | null; trustworthy: boolean } {
  console.log("");
  console.log(
    annealRounds > 0
      ? `Optimizer ON: ${annealRounds.toLocaleString("en-US")} rounds, ` +
          `seed ${DEFAULT_SCHEDULING_PARAMS.annealSeed}.`
      : "Optimizer OFF.",
  );

  const rows: Row[] = [];
  for (const penalty of PENALTIES) {
    const first = runOnce(pop, penalty, annealRounds);
    const second = runOnce(pop, penalty, annealRounds);
    const deterministic = first.fingerprint === second.fingerprint;
    if (!deterministic) {
      console.error(`penalty ${penalty}: TWO RUNS DIFFERED. The sweep is not trustworthy.`);
    }
    rows.push({
      penalty,
      seats: first.seats,
      filled: first.filled,
      shortOfTarget: first.report.shortOfTarget,
      belowMinHours: first.report.belowMinHours ?? 0,
      modalStartShare: first.stats.fairness.modalStartShareMean,
      welded: first.stats.fairness.welded,
      lockstepGroups: first.stats.fairness.lockstep.groups,
      lockstepPeople: first.stats.fairness.lockstep.people,
      spread: first.stats.fairness.weeklyMinutes.spread,
      pstdev: first.stats.fairness.weeklyMinutes.pstdev,
      // The faster of the two, so a cold first call does not read as cost.
      ms: Math.min(first.ms, second.ms),
      deterministic,
    });
  }

  // The table still prints when a run differed, clearly marked untrustworthy, so
  // whoever is debugging the nondeterminism can see what it produced. But the
  // process fails and no value is chosen from it.
  const trustworthy = rows.every((r) => r.deterministic);
  printTable(rows);
  console.log("");
  console.log(
    trustworthy
      ? "Determinism: every penalty ran twice and both runs matched exactly."
      : "Determinism: AT LEAST ONE PENALTY DIFFERED BETWEEN RUNS. Table is untrustworthy.",
  );
  if (!trustworthy) process.exitCode = 1;
  return { chosen: evaluate(rows, trustworthy), trustworthy };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const pop = args.snapshot ? snapshotPopulation(args.snapshot) : syntheticPopulation(args);

  console.log(`repeatStartPenalty sweep over ${pop.label}`);
  console.log("All other knobs at DEFAULT_SCHEDULING_PARAMS. No emails are printed.");

  const off = sweep(pop, 0);
  if (args.anneal === 0) return;
  const on = sweep(pop, args.anneal);

  const shipped = DEFAULT_SCHEDULING_PARAMS.repeatStartPenalty;
  const say = (chosen: number | null) =>
    chosen === null ? `nothing (keeps ${shipped})` : String(chosen);

  console.log("");
  if (!off.trustworthy || !on.trustworthy) {
    console.log("A sweep could not reproduce itself, so the two cannot be compared.");
  } else if (off.chosen === on.chosen) {
    console.log(
      `Both sweeps chose ${say(on.chosen)}, so the optimizer does not change the answer.`,
    );
  } else {
    console.log(
      `The sweeps disagree: ${say(off.chosen)} with the optimizer off, ` +
        `${say(on.chosen)} with it on. The shipped default follows the optimizer-on ` +
        `sweep, and moves off ${shipped} only when that sweep names a value outright.`,
    );
  }
}

main();
