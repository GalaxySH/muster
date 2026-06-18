/**
 * Entry-time validation rules engine (PLAN.md §5, §8).
 *
 * Hard rules block submission; soft rules are allowed but raise a flag for the
 * scheduler. This is a pure function of the selection + position config so it
 * can run identically on the client (live feedback) and the server (authority).
 */
import { dayTypeOf, type Position, type SelectedShift, type ShiftBlock } from "./types";
import { deriveOpenClose } from "./blocks";
import {
  computeCapacity,
  distinctSelectedDays,
  type CapacityOptions,
  type CapacityResult,
} from "./capacity";

export type CheckId = "min_hours" | "open_or_close" | "min_days" | "weekend";
export type FlagType = "auto_assigned_weekend" | "travel_late";

export interface Check {
  id: CheckId;
  severity: "hard" | "soft";
  passed: boolean;
  detail: string;
}

export interface Flag {
  type: FlagType;
  detail: string;
}

export interface SubmissionValidation {
  capacity: CapacityResult;
  daysCovered: number;
  checks: Check[];
  flags: Flag[];
  /** true when every hard check passes. */
  canSubmit: boolean;
}

// Capacity is float-valued (×0.5 weekend factor); compare with a small tolerance.
const EPSILON_MINUTES = 1e-6;

const hours = (minutes: number) => (minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1);

export function validateAvailability(
  selection: readonly SelectedShift[],
  position: Position,
  blocks: readonly ShiftBlock[],
  options: CapacityOptions,
): SubmissionValidation {
  const capacity = computeCapacity(selection, blocks, options);
  const days = distinctSelectedDays(selection);
  const selectedIds = new Set(selection.map((s) => s.blockId));

  const checks: Check[] = [];

  // #2 — min hours (hard): best non-overlapping packing, cycle-averaged, ≥ floor.
  const floorMinutes = position.minHours * 60;
  checks.push({
    id: "min_hours",
    severity: "hard",
    passed: capacity.weeklyAverageMinutes + EPSILON_MINUTES >= floorMinutes,
    detail: `${hours(capacity.weeklyAverageMinutes)}h reachable vs ${position.minHours}h floor`,
  });

  // #6 — at least one opening OR one closing block selected (hard).
  const openCloseIds = openAndCloseIds(blocks);
  const hasOpenOrClose = [...selectedIds].some((id) => openCloseIds.has(id));
  checks.push({
    id: "open_or_close",
    severity: "hard",
    passed: hasOpenOrClose,
    detail: hasOpenOrClose ? "open or close selected" : "no opening or closing block selected",
  });

  // #7 — selection spans at least minDays distinct days (hard).
  checks.push({
    id: "min_days",
    severity: "hard",
    passed: days.size >= position.minDays,
    detail: `${days.size} day(s) vs ${position.minDays} required`,
  });

  // #5 — must work a weekend shift (soft; Barista exempt).
  const flags: Flag[] = [];
  if (!position.weekendExempt) {
    const hasWeekend = selection.some((s) => dayTypeOf(s.day) === "weekend");
    checks.push({
      id: "weekend",
      severity: "soft",
      passed: hasWeekend,
      detail: hasWeekend ? "weekend shift selected" : "no weekend shift — will be auto-assigned",
    });
    if (!hasWeekend) {
      flags.push({
        type: "auto_assigned_weekend",
        detail: "No weekend shift selected; a weekend shift will be auto-assigned.",
      });
    }
  }

  const canSubmit = checks.filter((c) => c.severity === "hard").every((c) => c.passed);

  return { capacity, daysCovered: days.size, checks, flags, canSubmit };
}

/** Set of block ids that are the derived open or close of either day-type. */
function openAndCloseIds(blocks: readonly ShiftBlock[]): Set<string> {
  const result = new Set<string>();
  for (const dayType of ["weekday", "weekend"] as const) {
    const { openId, closeId } = deriveOpenClose(blocks.filter((b) => b.dayType === dayType));
    if (openId) result.add(openId);
    if (closeId) result.add(closeId);
  }
  return result;
}
