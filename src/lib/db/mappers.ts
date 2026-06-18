/**
 * Pure mappers from DB rows to domain types, so domain logic stays decoupled
 * from the persistence shape (e.g. start/end minutes column names).
 */
import type { positions, shiftBlocks } from "./schema";
import type { Position, ShiftBlock } from "@/lib/domain/types";

type PositionRow = typeof positions.$inferSelect;
type ShiftBlockRow = typeof shiftBlocks.$inferSelect;

export function toDomainPosition(row: PositionRow): Position {
  return {
    id: row.id,
    name: row.name,
    minHours: row.minHours,
    minDays: row.minDays,
    weekendExempt: row.weekendExempt,
  };
}

export function toDomainBlock(row: ShiftBlockRow): ShiftBlock {
  return {
    id: row.id,
    positionId: row.positionId,
    dayType: row.dayType,
    start: row.startMinutes,
    end: row.endMinutes,
    highDemand: row.highDemand,
  };
}
