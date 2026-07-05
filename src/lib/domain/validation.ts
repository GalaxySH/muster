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

export type CheckId = "min_hours" | "open_or_close" | "min_days" | "weekend" | "desired_hours";
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

  // #2 — minimum hours (hard): best non-overlapping packing, cycle-averaged.
  const minMinutes = position.minHours * 60;
  const availableHours = hours(capacity.weeklyAverageMinutes);
  checks.push({
    id: "min_hours",
    severity: "hard",
    passed: capacity.weeklyAverageMinutes + EPSILON_MINUTES >= minMinutes,
    detail: `${availableHours}h selected of ${position.minHours}h minimum`,
  });

  // #6 — at least one opening OR one closing block selected (hard).
  const openCloseIds = openAndCloseIds(blocks);
  const hasOpenOrClose = [...selectedIds].some((id) => openCloseIds.has(id));
  checks.push({
    id: "open_or_close",
    severity: "hard",
    passed: hasOpenOrClose,
    detail: hasOpenOrClose
      ? "an opening or closing shift is selected"
      : "select an opening or closing shift",
  });

  // #7 — selection spans at least minDays distinct days (hard).
  checks.push({
    id: "min_days",
    severity: "hard",
    passed: days.size >= position.minDays,
    detail: `${days.size} of ${position.minDays} required days selected`,
  });

  // #5 — must work a weekend shift (soft; Barista exempt).
  const flags: Flag[] = [];
  if (!position.weekendExempt) {
    const hasWeekend = selection.some((s) => dayTypeOf(s.day) === "weekend");
    checks.push({
      id: "weekend",
      severity: "soft",
      passed: hasWeekend,
      detail: hasWeekend
        ? "a weekend shift is selected"
        : "no weekend shift selected; one will be auto-assigned",
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

/**
 * Desired weekly hours must be entered and reach the position floor (hard).
 * Lives outside validateAvailability because desired hours sits beside the
 * selection, not in it; the client checklist and both server gates
 * (saveAvailability "continue" / finalizeSubmission) run this same check.
 * Only the minimum is enforced — the 20/30h cap stays scheduler-side context.
 */
export function checkDesiredHours(desiredHours: number | null, position: Position): Check {
  const entered = desiredHours !== null && Number.isFinite(desiredHours);
  const passed = entered && desiredHours >= position.minHours;
  return {
    id: "desired_hours",
    severity: "hard",
    passed,
    detail: !entered
      ? "enter your desired weekly hours"
      : passed
        ? `desired weekly hours: ${desiredHours}h`
        : `desired weekly hours must be at least ${position.minHours}h for your position`,
  };
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
