/**
 * Pure view-model helpers for the per-student admin view (PLAN.md §10a).
 *
 * Reuses the student-form grid model (rows = blocks per day-type, derived
 * open/close, labels) and overlays the persisted selection + any auto-assigned
 * weekend cell into a per-cell state the admin grid renders directly. No I/O —
 * the route loads data and hands it here.
 */
import { buildGridModel, type BlockRow, type SubGrid } from "@/lib/availability/grid";
import type { Day, SelectedShift, ShiftBlock } from "@/lib/domain/types";

/** Max weekly hours used as scheduler-side context (PLAN §3); never an entry cap. */
export const MAX_HOURS_DOMESTIC = 30;
export const MAX_HOURS_INTERNATIONAL = 20;

export function hourCap(international: boolean): number {
  return international ? MAX_HOURS_INTERNATIONAL : MAX_HOURS_DOMESTIC;
}

/** "off" = not selected, "on" = student's pick, "auto" = machine-assigned (§5). */
export type CellState = "off" | "on" | "auto";

export interface AdminBlockRow extends BlockRow {
  /** One state per day in the parent sub-grid's `days`, same order. */
  cells: CellState[];
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

function overlay(sub: SubGrid, onKeys: Set<string>, autoKeys: Set<string>): AdminSubGrid {
  return {
    dayType: sub.dayType,
    days: sub.days,
    rows: sub.rows.map((row) => ({
      ...row,
      cells: sub.days.map((day) => {
        const k = keyOf(row.block.id, day);
        // Auto-assignment wins so a re-submit's machine cell reads distinctly
        // even if it also appears as a manual pick.
        if (autoKeys.has(k)) return "auto" as const;
        if (onKeys.has(k)) return "on" as const;
        return "off" as const;
      }),
    })),
  };
}

export function buildAdminGrid(
  blocks: readonly ShiftBlock[],
  selection: readonly SelectedShift[],
  autoAssigned: readonly SelectedShift[],
): AdminGridModel {
  const base = buildGridModel(blocks);
  const onKeys = new Set(selection.map((s) => keyOf(s.blockId, s.day)));
  const autoKeys = new Set(autoAssigned.map((s) => keyOf(s.blockId, s.day)));
  return {
    weekday: overlay(base.weekday, onKeys, autoKeys),
    weekend: base.weekend ? overlay(base.weekend, onKeys, autoKeys) : null,
  };
}
