/**
 * Pure view-model helpers for the per-student admin view (PLAN.md §10a).
 *
 * Reuses the student-form grid model (rows = blocks per day-type, derived
 * open/close, labels) and overlays three per-cell layers the admin grid renders
 * directly: the persisted selection, any auto-assigned weekend cell, and the
 * current schedule run's assignment for that (block, day). No I/O; the route
 * loads data and hands it here.
 */
import { buildGridModel, type BlockRow, type SubGrid } from "@/lib/availability/grid";
import type { AssignmentSource } from "@/lib/domain/scheduling/types";
import type { Day, SelectedShift, ShiftBlock } from "@/lib/domain/types";

/** One assigned (block, day) cell of the current run, as the grid overlay reads it. */
export interface AssignedCellRef extends SelectedShift {
  source: AssignmentSource;
}

/**
 * One grid cell: the preference half (what the student offered) and the
 * schedule half (what the current run assigns). Preferences and assignments
 * live in separate tables, so both can be true independently.
 */
export interface AdminCell {
  /** The student's own pick. */
  selected: boolean;
  /** Machine-assigned weekend cell (PLAN §5 #5). */
  autoAssigned: boolean;
  /** Assigned in the current schedule run. */
  assigned: boolean;
  /** Who wrote the assignment; null when unassigned. */
  assignmentSource: AssignmentSource | null;
}

export interface AdminBlockRow extends BlockRow {
  /** One cell per day in the parent sub-grid's `days`, same order. */
  cells: AdminCell[];
}

export interface AdminSubGrid extends Omit<SubGrid, "rows"> {
  rows: AdminBlockRow[];
}

export interface AdminGridModel {
  weekday: AdminSubGrid;
  /** null for weekday-only positions (Barista). */
  weekend: AdminSubGrid | null;
}

const keyOf = (blockId: string, day: Day) => `${blockId}::${day}`;

function overlay(
  sub: SubGrid,
  onKeys: Set<string>,
  autoKeys: Set<string>,
  assignedByKey: Map<string, AssignmentSource>,
): AdminSubGrid {
  return {
    dayType: sub.dayType,
    days: sub.days,
    rows: sub.rows.map((row) => ({
      ...row,
      cells: sub.days.map((day) => {
        const k = keyOf(row.block.id, day);
        return {
          selected: onKeys.has(k),
          autoAssigned: autoKeys.has(k),
          assigned: assignedByKey.has(k),
          assignmentSource: assignedByKey.get(k) ?? null,
        };
      }),
    })),
  };
}

export function buildAdminGrid(
  blocks: readonly ShiftBlock[],
  selection: readonly SelectedShift[],
  autoAssigned: readonly SelectedShift[],
  highDemandCellKeys: ReadonlySet<string> = new Set(),
  assignments: readonly AssignedCellRef[] = [],
): AdminGridModel {
  const base = buildGridModel(blocks, highDemandCellKeys);
  const onKeys = new Set(selection.map((s) => keyOf(s.blockId, s.day)));
  const autoKeys = new Set(autoAssigned.map((s) => keyOf(s.blockId, s.day)));
  const assignedByKey = new Map(assignments.map((a) => [keyOf(a.blockId, a.day), a.source]));
  return {
    weekday: overlay(base.weekday, onKeys, autoKeys, assignedByKey),
    weekend: base.weekend ? overlay(base.weekend, onKeys, autoKeys, assignedByKey) : null,
  };
}
