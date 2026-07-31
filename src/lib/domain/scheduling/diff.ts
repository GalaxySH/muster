/**
 * Pure run-to-run diffing for the recommended schedule (Phase C of
 * docs/schedule-generation-plan.md): which cells were added, removed, or moved
 * between rotation weeks from one run to another, rolled up per student, plus
 * the frozen-rows-vs-edited-selections mismatch and the staleness copy.
 *
 * Everything here is deterministic and I/O-free; the loaders in
 * `schedule/data.ts` feed it rows and the admin page renders the result.
 */
import { ALL_DAYS, type Day, type SelectedShift } from "../types";
import type { AssignmentSource, Cohort, StudentScheduleReport } from "./types";

/** One assignment row of a run, as the diff consumes it. */
export interface RunCell {
  studentEmail: string;
  blockId: string;
  day: Day;
  cohort: Cohort;
  source: AssignmentSource;
}

/** One run's diff inputs: its assignment rows and its report's student rows. */
export interface RunSide {
  assignments: readonly RunCell[];
  students: readonly StudentScheduleReport[];
}

export type ShiftChangeKind = "added" | "removed" | "moved";

/** One cell that differs between the two runs. */
export interface ShiftChange {
  blockId: string;
  day: Day;
  kind: ShiftChangeKind;
  /** The cell's rotation week: after's for added/moved, before's for removed. */
  cohort: Cohort;
  /** "moved" only: the rotation week the cell held in the before run. */
  fromCohort?: Cohort;
  source: AssignmentSource;
}

export interface StudentRunDiff {
  email: string;
  /** The run report's row, or null when the student is absent from that run. */
  before: StudentScheduleReport | null;
  after: StudentScheduleReport | null;
  /** Sorted by day (Sunday-start week), then block id. */
  changes: ShiftChange[];
}

export interface RunDiff {
  /** Students with any change or present in only one run, sorted by email. */
  students: StudentRunDiff[];
  added: number;
  removed: number;
  moved: number;
  /** Students present in both runs whose cells are identical. */
  unchanged: number;
}

const DAY_INDEX = new Map(ALL_DAYS.map((d, i) => [d, i]));

const cellKey = (c: { studentEmail: string; blockId: string; day: Day }) =>
  `${c.studentEmail}|${c.blockId}|${c.day}`;

/** Diff two runs: per-shift added/removed/moved cells, grouped per student. */
export function diffRuns(before: RunSide, after: RunSide): RunDiff {
  const beforeCells = new Map(before.assignments.map((c) => [cellKey(c), c]));
  const afterCells = new Map(after.assignments.map((c) => [cellKey(c), c]));

  const changesByEmail = new Map<string, ShiftChange[]>();
  const push = (email: string, change: ShiftChange) => {
    const list = changesByEmail.get(email) ?? [];
    list.push(change);
    changesByEmail.set(email, list);
  };

  let added = 0;
  let removed = 0;
  let moved = 0;
  for (const c of after.assignments) {
    const prior = beforeCells.get(cellKey(c));
    if (!prior) {
      added += 1;
      push(c.studentEmail, {
        blockId: c.blockId,
        day: c.day,
        kind: "added",
        cohort: c.cohort,
        source: c.source,
      });
    } else if (prior.cohort !== c.cohort) {
      moved += 1;
      push(c.studentEmail, {
        blockId: c.blockId,
        day: c.day,
        kind: "moved",
        cohort: c.cohort,
        fromCohort: prior.cohort,
        source: c.source,
      });
    }
  }
  for (const c of before.assignments) {
    if (afterCells.has(cellKey(c))) continue;
    removed += 1;
    push(c.studentEmail, {
      blockId: c.blockId,
      day: c.day,
      kind: "removed",
      cohort: c.cohort,
      source: c.source,
    });
  }

  const beforeByEmail = new Map(before.students.map((s) => [s.email, s]));
  const afterByEmail = new Map(after.students.map((s) => [s.email, s]));

  // Students worth a row: anyone whose cells changed, plus anyone who appears
  // in only one of the two runs (entered or left the schedule).
  const emails = new Set<string>(changesByEmail.keys());
  for (const email of beforeByEmail.keys()) if (!afterByEmail.has(email)) emails.add(email);
  for (const email of afterByEmail.keys()) if (!beforeByEmail.has(email)) emails.add(email);

  let unchanged = 0;
  for (const email of beforeByEmail.keys()) {
    if (afterByEmail.has(email) && !changesByEmail.has(email)) unchanged += 1;
  }

  const students: StudentRunDiff[] = [...emails].sort().map((email) => ({
    email,
    before: beforeByEmail.get(email) ?? null,
    after: afterByEmail.get(email) ?? null,
    changes: (changesByEmail.get(email) ?? []).sort(
      (a, b) =>
        DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)! ||
        a.blockId.localeCompare(b.blockId) ||
        a.kind.localeCompare(b.kind),
    ),
  }));

  return { students, added, removed, moved, unchanged };
}

/** One frozen student whose kept rows fall outside their current selections. */
export interface FrozenMismatch {
  email: string;
  /** Kept cells no current selection covers, sorted by day then block id. */
  cells: { blockId: string; day: Day }[];
}

/**
 * Frozen rows vs edited selections (plan §8): a student marked scheduled keeps
 * their carried rows even after changing their availability, so a kept cell can
 * fall outside what they now say they can work. Auto-assigned weekend cells
 * count as selections; callers pass the full selection set.
 */
export function frozenSelectionMismatches(
  assignments: readonly RunCell[],
  frozenEmails: ReadonlySet<string>,
  selections: ReadonlyMap<string, readonly SelectedShift[]>,
): FrozenMismatch[] {
  const selected = new Set<string>();
  for (const [email, cells] of selections) {
    for (const c of cells) selected.add(`${email}|${c.blockId}|${c.day}`);
  }

  const byEmail = new Map<string, { blockId: string; day: Day }[]>();
  for (const a of assignments) {
    if (!frozenEmails.has(a.studentEmail)) continue;
    if (selected.has(cellKey(a))) continue;
    const list = byEmail.get(a.studentEmail) ?? [];
    list.push({ blockId: a.blockId, day: a.day });
    byEmail.set(a.studentEmail, list);
  }

  return [...byEmail.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([email, cells]) => ({
      email,
      cells: cells.sort(
        (a, b) =>
          DAY_INDEX.get(a.day)! - DAY_INDEX.get(b.day)! || a.blockId.localeCompare(b.blockId),
      ),
    }));
}

/**
 * The staleness line shared by the /admin/schedule banner and the hub alert:
 * how many eligible responses arrived or were edited after the current run was
 * generated. Null when the run is up to date (no line to show).
 */
export function stalenessMessage(newSubmissions: number, edited: number): string | null {
  const news =
    newSubmissions > 0
      ? `${newSubmissions} new ${newSubmissions === 1 ? "submission" : "submissions"}`
      : null;
  const edits =
    edited > 0
      ? `${edited} ${news ? "edited" : edited === 1 ? "response edited" : "responses edited"}`
      : null;
  const parts = [news, edits].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return `${parts.join(" and ")} since this schedule was generated.`;
}
