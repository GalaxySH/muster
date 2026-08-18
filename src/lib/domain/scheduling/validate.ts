/**
 * Independent post-generation labor validator.
 *
 * This module is a deliberate second derivation of the labor rules the engine enforces
 * in ./labor.ts. It is written from the spec (docs/constraints-from-welcome-week.md §1
 * and the canonical fortnight calendar in docs/generator-constraints-fairness-plan.md §1),
 * not from the engine's code, so that running both against the same schedule can surface
 * a bug in either one. A divergence between validate.ts and labor.ts is that safety net
 * working, not duplication to eliminate. Do not fold this file into labor.ts or share
 * helpers with it; everything here, including the interval merging and the fortnight
 * mapping, is re-implemented on purpose.
 *
 * The calendar: the schedule is a dateless repeating weekly template realized on a
 * repeating fortnight of slots 0..13 = [Sun1, Mon1..Fri1, Sat1, Sun2, Mon2..Fri2, Sat2].
 * W2W week 1 is slots 0..6, week 2 is slots 7..13, and slot 13 is cyclically adjacent to
 * slot 0. Each row maps by its own cohort value: weekday rows occupy both halves (d and
 * d + 7), "a" rows occupy Sat1 (6) and Sun2 (7), "b" rows occupy Sat2 (13) and Sun1 (0),
 * and "every" rows occupy all four weekend slots.
 *
 * The validator judges every row it is given. Frozen and manual rows are never dropped
 * or excused; they are exactly what read-time validation exists to catch. Same-person
 * overlapping rows are deliberately not flagged: staggered doubles are legal and merge
 * into one span with shared minutes counted once.
 */
import type { Day } from "../types";
import type { TimeRange } from "../time";
import type { Cohort } from "./types";

export interface ValidatorRow {
  studentEmail: string;
  blockId: string;
  day: Day;
  cohort: Cohort;
  /** minutes past midnight */
  start: number;
  /** minutes past midnight */
  end: number;
  source: "engine" | "manual";
  frozen: boolean;
}

export interface ValidatorLimits {
  dayCapMinutes: number;
  maxConsecutiveDays: number;
  maxDaysPerWeek: number;
  preferredDaysPerWeek: number;
  minRestMinutes: number;
  preferredRestMinutes: number;
}

export interface StudentLaborFinding {
  email: string;
  /** true when any of the student's rows is frozen */
  frozen: boolean;
  violations: Array<{
    rule:
      | "day-hours"
      | "week-hours"
      | "consecutive-days"
      | "days-per-week"
      | "clopen"
      | "short-rest"
      | "split-shift";
    severity: "hard" | "soft";
    /** admin-facing, natural language */
    message: string;
    /** any row contributing to this violation is source "manual" */
    involvesManual: boolean;
  }>;
}

type Violation = StudentLaborFinding["violations"][number];

/** The 40h W2W weekly cap is payroll law, a constant of the domain, never a knob. */
const WEEK_CAP_MINUTES = 40 * 60;

const SLOT_COUNT = 14;

/** Sunday-start day index within one week half: Sun=0 .. Sat=6. */
const DAY_INDEX: { readonly [day: string]: number | undefined } = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Day name for a fortnight slot; both halves share the Sun..Sat labels. */
const SLOT_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function slotLabel(slot: number): string {
  return SLOT_LABEL[slot % 7] ?? "";
}

/**
 * Fortnight slots a row occupies, from the row's own cohort value. Mapping each row
 * independently is what makes mixed rows from manual edits come out right. A row whose
 * day or cohort has no defined place on the fortnight (an unknown value, or a rotation
 * cohort on a Mon..Fri day) maps to no slots and is ignored rather than guessed at.
 */
function slotsForRow(day: Day, cohort: Cohort): number[] {
  const index = DAY_INDEX[day];
  if (index === undefined) return [];
  if (cohort === "weekday") return [index, index + 7];
  if (day !== "sat" && day !== "sun") return [];
  switch (cohort) {
    case "a":
      return day === "sat" ? [6] : [7];
    case "b":
      return day === "sat" ? [13] : [0];
    case "every":
      return day === "sat" ? [6, 13] : [0, 7];
    default:
      return [];
  }
}

/**
 * Merge a slot's minute ranges into contiguous runs, sorted by start. Touching or
 * overlapping ranges merge, so shared minutes count once and an exact abutment is one
 * run. Re-implemented here on purpose; see the header.
 */
function mergeRuns(rows: readonly ValidatorRow[]): TimeRange[] {
  const sorted = rows
    .map((row) => ({ start: row.start, end: row.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const runs: TimeRange[] = [];
  for (const range of sorted) {
    const last = runs[runs.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      runs.push({ ...range });
    }
  }
  return runs;
}

/** Zero-padded 24h clock, with a midnight end (1440) shown as 24:00. */
function hhmm(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Minutes as hours for messages: 480 -> "8h", 390 -> "6.5h", 481 -> "8.02h". */
function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 100) / 100}h`;
}

/** Natural-language list: "A", "A and B", "A, B and C". */
function listJoin(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

interface Slot {
  rows: ValidatorRow[];
  runs: TimeRange[];
  minutes: number;
  /** start of the slot's first merged run; the day's opening clock-in */
  firstStart: number;
  /** end of the slot's last merged run; the day's closing clock-out */
  lastEnd: number;
}

/**
 * Maximal cyclic runs of occupied slots on the 14-cycle, by ascending start slot. A run
 * may wrap 13 -> 0; all fourteen occupied is a single run of 14.
 */
function cyclicRuns(occupied: readonly boolean[]): Array<{ start: number; length: number }> {
  if (occupied.every(Boolean)) return [{ start: 0, length: SLOT_COUNT }];
  const runs: Array<{ start: number; length: number }> = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const previous = (slot + SLOT_COUNT - 1) % SLOT_COUNT;
    if (!occupied[slot] || occupied[previous]) continue;
    let length = 1;
    while (occupied[(slot + length) % SLOT_COUNT]) length++;
    runs.push({ start: slot, length });
  }
  return runs;
}

function validateStudent(rows: readonly ValidatorRow[], limits: ValidatorLimits): Violation[] {
  // Map each row onto the fortnight and merge each occupied slot's ranges.
  const slotRows: ValidatorRow[][] = Array.from({ length: SLOT_COUNT }, () => []);
  for (const row of rows) {
    for (const slot of slotsForRow(row.day, row.cohort)) {
      slotRows[slot]?.push(row);
    }
  }
  const slots: Array<Slot | null> = slotRows.map((mapped) => {
    if (mapped.length === 0) return null;
    const runs = mergeRuns(mapped);
    const minutes = runs.reduce((total, run) => total + (run.end - run.start), 0);
    return {
      rows: mapped,
      runs,
      minutes,
      // A mapped slot always has at least one run; the fallbacks never fire.
      firstStart: runs[0]?.start ?? 0,
      lastEnd: runs[runs.length - 1]?.end ?? 0,
    };
  });

  const raw: Violation[] = [];
  const add = (
    rule: Violation["rule"],
    severity: Violation["severity"],
    message: string,
    citedSlots: readonly number[],
  ) => {
    const involvesManual = citedSlots.some(
      (slot) => slots[slot]?.rows.some((row) => row.source === "manual") ?? false,
    );
    raw.push({ rule, severity, message, involvesManual });
  };

  // Per-slot rules: split-shift and the day cap.
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const info = slots[slot];
    if (!info) continue;
    if (info.runs.length > 1) {
      const spans = info.runs.map((run) => `${hhmm(run.start)} to ${hhmm(run.end)}`);
      add("split-shift", "hard", `${slotLabel(slot)} has a split shift: ${listJoin(spans)}`, [
        slot,
      ]);
    }
    if (info.minutes > limits.dayCapMinutes) {
      add(
        "day-hours",
        "hard",
        `${slotLabel(slot)} totals ${formatHours(info.minutes)}, over the ${formatHours(
          limits.dayCapMinutes,
        )} day cap`,
        [slot],
      );
    }
  }

  // Per-half rules: the 40h W2W week and days per week.
  for (let half = 0; half < 2; half++) {
    const halfSlots = Array.from({ length: 7 }, (_, offset) => half * 7 + offset);
    const occupiedCount = halfSlots.filter((slot) => slots[slot] !== null).length;
    const halfMinutes = halfSlots.reduce((total, slot) => total + (slots[slot]?.minutes ?? 0), 0);
    const week = `Week ${half + 1}`;
    if (halfMinutes > WEEK_CAP_MINUTES) {
      add(
        "week-hours",
        "hard",
        `${week} totals ${formatHours(halfMinutes)}, over the 40h weekly cap`,
        halfSlots,
      );
    }
    if (occupiedCount > limits.maxDaysPerWeek) {
      add(
        "days-per-week",
        "hard",
        `${week} has ${occupiedCount} work days, over the max of ${limits.maxDaysPerWeek}`,
        halfSlots,
      );
    } else if (occupiedCount > limits.preferredDaysPerWeek) {
      add(
        "days-per-week",
        "soft",
        `${week} has ${occupiedCount} work days, more than the preferred ${limits.preferredDaysPerWeek}`,
        halfSlots,
      );
    }
  }

  // Consecutive days, evaluated cyclically on the 14-cycle.
  const occupied = slots.map((slot) => slot !== null);
  for (const run of cyclicRuns(occupied)) {
    if (run.length <= limits.maxConsecutiveDays) continue;
    const runSlots = Array.from({ length: run.length }, (_, offset) => (run.start + offset) % 14);
    const message =
      run.length === SLOT_COUNT
        ? `Works ${run.length} days in a row with no day off, over the max of ${limits.maxConsecutiveDays}`
        : `Works ${run.length} days in a row, over the max of ${limits.maxConsecutiveDays}`;
    add("consecutive-days", "hard", message, runSlots);
  }

  // Overnight rest between each cyclically adjacent pair of occupied slots.
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const next = (slot + 1) % SLOT_COUNT;
    const evening = slots[slot];
    const morning = slots[next];
    if (!evening || !morning) continue;
    const rest = morning.firstStart + 1440 - evening.lastEnd;
    if (rest >= limits.preferredRestMinutes) continue;
    const message = `${slotLabel(slot)} close ${hhmm(evening.lastEnd)} to ${slotLabel(
      next,
    )} open ${hhmm(morning.firstStart)} is ${formatHours(rest)} rest`;
    if (rest < limits.minRestMinutes) {
      add("clopen", "hard", message, [slot, next]);
    } else {
      add("short-rest", "soft", message, [slot, next]);
    }
  }

  // A weekday row occupies both halves, so one bad template day would otherwise report
  // twice with the same words. Collapse exact repeats, keeping the manual flag if any
  // copy involved a manual row.
  const deduped = new Map<string, Violation>();
  for (const violation of raw) {
    const key = `${violation.rule}\u0000${violation.severity}\u0000${violation.message}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.involvesManual = existing.involvesManual || violation.involvesManual;
    } else {
      deduped.set(key, violation);
    }
  }

  const severityRank: Record<Violation["severity"], number> = { hard: 0, soft: 1 };
  return [...deduped.values()].sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
}

/**
 * Re-derive every labor verdict for a run's assignment rows, independently of the
 * engine. Students with no violations produce no entry; findings are ordered by email,
 * and each student's violations are ordered hard first, then by rule name.
 */
export function validateRunLabor(
  rows: ValidatorRow[],
  limits: ValidatorLimits,
): StudentLaborFinding[] {
  const byStudent = new Map<string, ValidatorRow[]>();
  for (const row of rows) {
    const existing = byStudent.get(row.studentEmail);
    if (existing) {
      existing.push(row);
    } else {
      byStudent.set(row.studentEmail, [row]);
    }
  }

  const findings: StudentLaborFinding[] = [];
  const students = [...byStudent.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [email, studentRows] of students) {
    const violations = validateStudent(studentRows, limits);
    if (violations.length === 0) continue;
    findings.push({
      email,
      frozen: studentRows.some((row) => row.frozen),
      violations,
    });
  }
  return findings;
}
