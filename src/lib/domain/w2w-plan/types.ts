/**
 * Types for the W2W shift-plan round-trip (docs/w2w-shift-plan-roundtrip.md).
 *
 * A plan is one week of W2W shift rows, one row per budgeted seat. Muster
 * never adds or removes rows; it only resolves each row against its own
 * positions/blocks and (on export) writes the employee identity. Passthrough
 * columns keep their verbatim source strings so the re-export is byte-stable.
 */
import type { Day, DayType, ShiftBlock } from "../types";

/** One seat row parsed from a W2W schedule export. */
export interface W2wPlanRow {
  /** 0-based position in the source file; the determinism backbone. */
  seq: number;
  w2wPositionId: string;
  w2wPositionName: string;
  category: string;
  description: string;
  day: Day;
  /** Verbatim source strings (e.g. "08:00 AM"), re-emitted unchanged. */
  startTime: string;
  endTime: string;
  duration: string;
  startMinutes: number;
  endMinutes: number;
  /** Verbatim prior assignment; empty string when the seat is open. */
  employeeName: string;
  employeeNumber: string;
}

/** A structural problem that refuses the whole upload (bad header, no rows). */
export interface W2wParseRefusal {
  ok: false;
  reason: string;
}

/** A per-row oddity that does not refuse the upload. */
export interface W2wParseIssue {
  /** 1-based data row number (header excluded). */
  row: number;
  message: string;
}

export interface W2wParseSuccess {
  ok: true;
  rows: W2wPlanRow[];
  issues: W2wParseIssue[];
}

export type W2wParseResult = W2wParseSuccess | W2wParseRefusal;

/** One W2W position mapped onto a Muster position (seeded config). */
export interface W2wPositionMapEntry {
  w2wPositionId: string;
  w2wPositionName: string;
  musterPositionId: string;
  /** Fill order among W2W positions sharing a Muster block (dock last). */
  fillOrder: number;
}

/**
 * The slice of a Muster shift block that matching needs. Derived from the
 * shared block type so a rename or removal there is a compile error here
 * instead of a silent mismatch while matching.
 */
export type MatchBlock = Pick<
  ShiftBlock,
  "id" | "positionId" | "dayType" | "start" | "end" | "desiredCapacity"
>;

/** A parsed row after resolution against the map and blocks. */
export interface MatchedPlanRow extends W2wPlanRow {
  /** Muster position the row's W2W position maps to; null when unmapped. */
  musterPositionId: string | null;
  /** Exact-matched Muster block; null when unmapped or no block matches. */
  matchedBlockId: string | null;
}

/** Seat counts for one matched block on one day. */
export interface BlockSeatCell {
  blockId: string;
  day: Day;
  seats: number;
}

/** Capacity comparison line for the import report and the capacity checkbox. */
export interface BlockCapacityLine {
  blockId: string;
  positionId: string;
  dayType: DayType;
  startMinutes: number;
  endMinutes: number;
  desiredCapacity: number | null;
  /** Max seats across the block's days; what the checkbox would set. */
  planSeats: number;
  /** True when the per-day seat counts differ within the day-type. */
  unevenDays: boolean;
}

/** Distinct unmatched shape, grouped for the report (never dropped). */
export interface UnmatchedShape {
  w2wPositionName: string;
  musterPositionId: string | null;
  dayType: DayType;
  startMinutes: number;
  endMinutes: number;
  description: string;
  rowCount: number;
}

export interface PlanMatchReport {
  rows: MatchedPlanRow[];
  matchedCount: number;
  unmatched: UnmatchedShape[];
  /** W2W position id/name pairs with no map entry. */
  unknownPositions: { w2wPositionId: string; w2wPositionName: string }[];
  capacity: BlockCapacityLine[];
  seatCells: BlockSeatCell[];
}
