/**
 * Builds the availability-grid view model (PLAN.md §7, §10a).
 *
 * Per day-type: rows = that day-type's blocks (sorted by start), tagged with the
 * derived open/close and a human label; columns = the calendar days the template
 * applies to. Weekend is null for weekday-only positions (Barista). Pure so the
 * client component just renders it.
 */
import { deriveOpenClose } from "@/lib/domain/blocks";
import { formatTime } from "@/lib/domain/time";
import {
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  type Day,
  type DayType,
  type ShiftBlock,
} from "@/lib/domain/types";

export interface BlockRow {
  block: ShiftBlock;
  isOpen: boolean;
  isClose: boolean;
  /** e.g. "6:30a–10:15a" */
  label: string;
}

export interface SubGrid {
  dayType: DayType;
  days: readonly Day[];
  rows: BlockRow[];
}

export interface GridModel {
  weekday: SubGrid;
  /** null when the position has no weekend block set (Barista). */
  weekend: SubGrid | null;
}

function buildSubGrid(
  blocks: readonly ShiftBlock[],
  dayType: DayType,
  days: readonly Day[],
): SubGrid {
  const set = blocks
    .filter((b) => b.dayType === dayType)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const { openId, closeId } = deriveOpenClose(set);
  const rows = set.map((block) => ({
    block,
    isOpen: block.id === openId,
    isClose: block.id === closeId,
    label: `${formatTime(block.start)}–${formatTime(block.end)}`,
  }));
  return { dayType, days, rows };
}

export function buildGridModel(blocks: readonly ShiftBlock[]): GridModel {
  const weekend = blocks.some((b) => b.dayType === "weekend")
    ? buildSubGrid(blocks, "weekend", WEEKEND_DAYS)
    : null;
  return {
    weekday: buildSubGrid(blocks, "weekday", WEEKDAY_DAYS),
    weekend,
  };
}
