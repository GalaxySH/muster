/**
 * Pure resolution of "effective" availability (PLAN.md §10a): the admin's
 * internal copy wins wherever one exists, the student's own submission
 * applies otherwise. Scheduling surfaces (the generator first of all) consume
 * the effective view; student-facing surfaces never do.
 *
 * Kept free of I/O so the override rule is unit-testable; server code loads
 * the internal copies (lib/availability/internal.ts) and hands them here.
 */
import type { SelectedShift } from "@/lib/domain/types";

/** One submission's internal copy, keyed by student email at the call site. */
/**
 * The effective weekend rotation (PLAN §10a): an admin's internal copy overrides
 * the student's own answer, and neither existing means no opt-in.
 *
 * This is the rotation half of the effective-availability rule. The cell half is
 * `effectiveSelections()` in ./internal.ts, which resolves which SHIFTS apply but
 * deliberately not this flag: cells are per (submission, block, day) and the flag
 * is per submission, so carrying it through that union would denormalize it onto
 * every row. Keeping them apart is fine; keeping the rule itself in one place is
 * the point. Weekend cells halve on this flag, so two surfaces disagreeing about
 * it report different hours for identical rows.
 *
 * Pass the internal copy's value (null or undefined when there is no copy) and
 * the student's own. Callers reading columns pass them straight through; callers
 * holding a loaded copy pass `internal?.everyWeekendOptIn ?? null`.
 */
export function effectiveRotation(
  internalOptIn: boolean | null | undefined,
  ownOptIn: boolean | null | undefined,
): boolean {
  return internalOptIn ?? ownOptIn ?? false;
}

export interface InternalCopy {
  everyWeekendOptIn: boolean;
  /** Every internal cell. Copies are literal: no machine-picked weekend. */
  selection: SelectedShift[];
}

/**
 * Replace each student's selection and weekend rotation with the internal
 * copy when one exists. Students without a copy pass through unchanged.
 */
export function applyInternalOverrides<
  S extends { email: string; everyWeekendOptIn: boolean; selection: SelectedShift[] },
>(students: readonly S[], internalByEmail: ReadonlyMap<string, InternalCopy>): S[] {
  return students.map((s) => {
    const internal = internalByEmail.get(s.email);
    if (!internal) return s;
    return { ...s, everyWeekendOptIn: internal.everyWeekendOptIn, selection: internal.selection };
  });
}

/** How an internal copy differs from the student's own stored answers. */
export interface InternalDiff {
  /** Cells in the internal copy the student's rows never had. */
  added: SelectedShift[];
  /** Student cells (own picks and the machine-assigned weekend) the copy dropped. */
  removed: SelectedShift[];
  rotationChanged: boolean;
}

const cellKey = (c: SelectedShift) => `${c.blockId}|${c.day}`;

/**
 * Diff the internal copy against the student's stored availability, for the
 * per-cell overlay and the banner summary on the per-student page. The
 * student side is their whole stored record: own picks plus the
 * machine-assigned weekend cell, since that is what the copy replaced.
 */
export function diffInternalFromStudent(
  student: { selection: SelectedShift[]; autoAssigned: SelectedShift[]; everyWeekendOptIn: boolean },
  internal: InternalCopy,
): InternalDiff {
  const studentCells = [...student.selection, ...student.autoAssigned];
  const studentKeys = new Set(studentCells.map(cellKey));
  const internalKeys = new Set(internal.selection.map(cellKey));
  return {
    added: internal.selection.filter((c) => !studentKeys.has(cellKey(c))),
    removed: studentCells.filter((c) => !internalKeys.has(cellKey(c))),
    rotationChanged: internal.everyWeekendOptIn !== student.everyWeekendOptIn,
  };
}
