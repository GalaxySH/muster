/**
 * Project the current schedule run onto the plan's seats
 * (docs/w2w-shift-plan-roundtrip.md §7). Full refill: the export mirrors the
 * Muster schedule exactly, and a name the run does not place on a shift never
 * survives from the imported file. The row set is the budget: every plan row
 * comes back exactly once, filled or not.
 */
import type { Day } from "../types";
import type { Cohort } from "../scheduling/types";
import type { W2wPlanRow, W2wPositionMapEntry } from "./types";

/** One (student x block x day) cell of the current run, resolved to a name. */
export interface FillAssignment {
  studentEmail: string;
  blockId: string;
  day: Day;
  cohort: Cohort;
}

export type WeekFile = "a" | "b";

export interface FilledRow extends W2wPlanRow {
  /** The name written to the export; "" leaves the seat open. */
  filledEmployeeName: string;
  /** Employee number when the mapping knows one (W2W prefers it). */
  filledEmployeeNumber: string;
  /** The student behind the fill, for warnings and the page view. */
  filledEmail: string | null;
}

/** A student the cell had no seat left for; named in the export warning. */
export interface OverflowStudent {
  studentEmail: string;
  blockId: string;
  day: Day;
}

export interface FillResult {
  rows: FilledRow[];
  overflow: OverflowStudent[];
  /** Students filled via the derived-name fallback (not in the mapping). */
  fallbackEmails: string[];
}

/** The identity a student exports under (docs §6). */
export interface ExportIdentity {
  name: string;
  employeeNumber: string;
  /** True when the name came from the roster derivation, not the mapping. */
  derived: boolean;
}

/** One student the plan had shifts for and the export does not. */
export interface DroppedName {
  name: string;
  /** Plan rows that carried this name. */
  rowCount: number;
}

/**
 * Students the imported plan gave shifts to who hold no seat in the finished
 * export (docs/w2w-shift-plan-roundtrip.md §7). The export is a full refill:
 * `fillPlan` ignores the name a row arrived with, so anyone the run does not
 * place is simply gone from the file and their seat ships open. Correct when
 * the schedule really moved them, data loss when the plan was uploaded to be
 * repaired and repair mode was never turned on.
 *
 * `filledEmails` must be the union across both week files, since a weekend
 * student appears in only one of them. Only names that resolve to a student
 * are reported: a real W2W week also carries permanent staff and managers
 * Muster never schedules, and listing them would bury the students. A name
 * `nameIndex` maps to null is ambiguous (two students derive it) and is not
 * anyone this run can be said to have dropped.
 */
export function droppedImportedNames(
  planRows: readonly { employeeName: string }[],
  filledEmails: ReadonlySet<string>,
  nameIndex: ReadonlyMap<string, string | null>,
): DroppedName[] {
  const counts = new Map<string, number>();
  for (const row of planRows) {
    if (row.employeeName === "") continue;
    counts.set(row.employeeName, (counts.get(row.employeeName) ?? 0) + 1);
  }
  const dropped: DroppedName[] = [];
  for (const [name, rowCount] of counts) {
    const email = nameIndex.get(name);
    if (email == null || filledEmails.has(email)) continue;
    dropped.push({ name, rowCount });
  }
  return dropped.sort((a, b) => b.rowCount - a.rowCount || a.name.localeCompare(b.name));
}

/** Which cohorts staff a weekend row in each week file. */
const WEEK_COHORTS: Record<WeekFile, readonly Cohort[]> = {
  a: ["a", "every"],
  b: ["b", "every"],
};

const cellKey = (blockId: string, day: Day) => `${blockId}|${day}`;

/**
 * Fill one week file. Deterministic throughout: seats order by the mapped
 * position's fillOrder then source order (dock rows after plain stocker
 * rows); students order by email. `identities` must cover every assigned
 * student (build it from the mapping with the derived-name fallback).
 */
export function fillPlan(
  rows: W2wPlanRow[],
  matchedBlockIds: (string | null)[],
  assignments: FillAssignment[],
  identities: Map<string, ExportIdentity>,
  map: W2wPositionMapEntry[],
  week: WeekFile,
): FillResult {
  if (matchedBlockIds.length !== rows.length) {
    throw new Error("matchedBlockIds must align with rows");
  }
  // Keyed by id and by name: matching falls back to the position name when
  // W2W recreates a position under a new id, and fill order must follow.
  const fillOrder = new Map<string, number>();
  const fillOrderByName = new Map<string, number>();
  for (const entry of map) {
    fillOrder.set(entry.w2wPositionId, entry.fillOrder);
    fillOrderByName.set(entry.w2wPositionName, entry.fillOrder);
  }
  const orderOf = (i: number): number =>
    fillOrder.get(rows[i]!.w2wPositionId) ?? fillOrderByName.get(rows[i]!.w2wPositionName) ?? 0;

  // Seats per cell, in deterministic fill order.
  const seats = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const blockId = matchedBlockIds[i];
    if (blockId == null) return;
    const key = cellKey(blockId, row.day);
    const list = seats.get(key);
    if (list) list.push(i);
    else seats.set(key, [i]);
  });
  for (const list of seats.values()) {
    list.sort((a, b) => orderOf(a) - orderOf(b) || a - b);
  }

  // Students per cell for this week's cohorts, ordered by email.
  const wanted = new Set<Cohort>(["weekday", ...WEEK_COHORTS[week]]);
  const students = new Map<string, string[]>();
  for (const a of assignments) {
    if (!wanted.has(a.cohort)) continue;
    const key = cellKey(a.blockId, a.day);
    const list = students.get(key);
    if (list) list.push(a.studentEmail);
    else students.set(key, [a.studentEmail]);
  }
  for (const list of students.values()) list.sort();

  const fillByRow = new Map<number, string>();
  const overflow: OverflowStudent[] = [];
  for (const [key, emails] of students) {
    const seatRows = seats.get(key) ?? [];
    emails.forEach((email, at) => {
      const rowIndex = seatRows[at];
      if (rowIndex === undefined) {
        const [blockId, day] = key.split("|") as [string, Day];
        overflow.push({ studentEmail: email, blockId, day });
      } else {
        fillByRow.set(rowIndex, email);
      }
    });
  }
  overflow.sort(
    (a, b) =>
      a.studentEmail.localeCompare(b.studentEmail) ||
      a.blockId.localeCompare(b.blockId) ||
      a.day.localeCompare(b.day),
  );

  const fallback = new Set<string>();
  const filled = rows.map((row, i): FilledRow => {
    const email = fillByRow.get(i) ?? null;
    if (email === null) {
      return { ...row, filledEmployeeName: "", filledEmployeeNumber: "", filledEmail: null };
    }
    const identity = identities.get(email);
    if (!identity) throw new Error(`No export identity for ${email}`);
    if (identity.derived) fallback.add(email);
    return {
      ...row,
      filledEmployeeName: identity.name,
      filledEmployeeNumber: identity.employeeNumber,
      filledEmail: email,
    };
  });

  return { rows: filled, overflow, fallbackEmails: [...fallback].sort() };
}
