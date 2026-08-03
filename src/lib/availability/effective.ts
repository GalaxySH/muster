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
export interface InternalCopy {
  everyWeekendOptIn: boolean;
  /** Every internal cell, machine-assigned weekend included. */
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
