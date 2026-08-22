/**
 * View model for the one-student schedule popup (/admin/schedule): the familiar
 * blocks-by-days grid, filled with the shifts the current run gives that
 * student. Pure so the modal and the hover card render the same model and the
 * shapes are unit-testable; the DB read lives in
 * admin/student-schedule-data.ts.
 *
 * Rows are the student's position's block layout plus any retired blocks their
 * carried rows still sit on, so the grid always shows every shift they hold,
 * exactly like their hours totals do.
 */
import { formatTime } from "@/lib/domain/time";
import type { AssignmentSource, Cohort } from "@/lib/domain/scheduling/types";
import { WEEKDAY_DAYS, WEEKEND_DAYS, type Day, type DayType } from "@/lib/domain/types";

/** One block the grid shows as a row; `retired` rows carry a marker. */
export interface StudentScheduleBlock {
  id: string;
  dayType: DayType;
  start: number;
  end: number;
  retired: boolean;
}

/** One current-run row for the student. */
export interface StudentScheduleCell {
  blockId: string;
  day: Day;
  cohort: Cohort;
  source: AssignmentSource;
}

export interface StudentGridCell {
  day: Day;
  /** null = the run does not put them on this cell. */
  source: AssignmentSource | null;
  /**
   * Rotation letter for a filled weekend cell (A, B, or E for every weekend);
   * null on weekday cells and empty cells, where there is nothing to say.
   */
  rotation: "A" | "B" | "E" | null;
}

export interface StudentGridRow {
  blockId: string;
  /** e.g. "8a–12p", same as the availability grid's row labels. */
  label: string;
  retired: boolean;
  /** One entry per day in the parent sub-grid's `days`, same order. */
  cells: StudentGridCell[];
}

export interface StudentGridSub {
  dayType: DayType;
  days: readonly Day[];
  rows: StudentGridRow[];
}

export interface StudentScheduleGrid {
  weekday: StudentGridSub;
  /** null when there are no weekend blocks to show. */
  weekend: StudentGridSub | null;
  /** Total filled cells, so callers can show "no shifts" without re-counting. */
  assignedCount: number;
}

const ROTATION_LETTER: Partial<Record<Cohort, "A" | "B" | "E">> = {
  a: "A",
  b: "B",
  every: "E",
};

function buildSub(
  blocks: readonly StudentScheduleBlock[],
  dayType: DayType,
  days: readonly Day[],
  byCell: Map<string, StudentScheduleCell>,
): StudentGridSub {
  const rows = blocks
    .filter((b) => b.dayType === dayType)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
    .map((block) => ({
      blockId: block.id,
      label: `${formatTime(block.start)}–${formatTime(block.end)}`,
      retired: block.retired,
      cells: days.map((day): StudentGridCell => {
        const cell = byCell.get(`${block.id}|${day}`);
        if (!cell) return { day, source: null, rotation: null };
        return {
          day,
          source: cell.source,
          rotation: dayType === "weekend" ? (ROTATION_LETTER[cell.cohort] ?? null) : null,
        };
      }),
    }));
  return { dayType, days, rows };
}

/**
 * Build the popup grid. `blocks` must include every block `cells` references
 * (the loader guarantees it by fetching assigned blocks retired or not); a cell
 * on a block not passed would otherwise vanish silently, so it throws instead.
 */
export function buildStudentScheduleGrid(
  blocks: readonly StudentScheduleBlock[],
  cells: readonly StudentScheduleCell[],
): StudentScheduleGrid {
  const known = new Set(blocks.map((b) => b.id));
  const byCell = new Map<string, StudentScheduleCell>();
  for (const cell of cells) {
    if (!known.has(cell.blockId)) {
      throw new Error(`assignment on block ${cell.blockId} missing from the block list`);
    }
    byCell.set(`${cell.blockId}|${cell.day}`, cell);
  }

  const weekend = blocks.some((b) => b.dayType === "weekend")
    ? buildSub(blocks, "weekend", WEEKEND_DAYS, byCell)
    : null;
  return {
    weekday: buildSub(blocks, "weekday", WEEKDAY_DAYS, byCell),
    weekend,
    assignedCount: byCell.size,
  };
}
