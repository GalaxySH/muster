/**
 * Admin-tunable knobs for the schedule engine (docs/schedule-generation-plan.md
 * §3.2), edited on /admin/schedule and stored as one JSON app_settings value.
 *
 * The priorities blend lateness into the scarcity score instead of dominating
 * it: a cell's pull is its unmet share of target plus the tier's priority/100.
 * So 0 fills all targeted cells evenly, 100 reproduces fill-nights-completely-
 * first, and the default 50 keeps night cells running about half a target
 * ahead while mornings still get coverage.
 *
 * The labor fields bound the rules in ./labor.ts (rest, consecutive days,
 * days per week). The 40h week cap is payroll law, a constant there, never a
 * knob here.
 */
export interface SchedulingParams {
  /** Most merged hours the engine puts on one student's single day. */
  dayCapHours: number;
  /** 0 fills evenly; 100 fills night cells to target before anything else. */
  nightPriority: number;
  /** Same scale for evening cells; usually about half the night value. */
  eveningPriority: number;
  /** 0 ignores repeats; 100 pushes hardest against the same start time again. */
  repeatStartPenalty: number;
  /** Hours below this between a day's close and the next open are a clopen (hard). */
  minRestHours: number;
  /** Rest the engine aims for; between min and this is flagged, not blocked. */
  preferredRestHours: number;
  /** Longest allowed run of working days over the two week rotation cycle. */
  maxConsecutiveDays: number;
  /** Hard ceiling on working days in one W2W week. */
  maxDaysPerWeek: number;
  /** Days per week the engine aims for; up to the max is a last resort. */
  preferredDaysPerWeek: number;
}

export const DEFAULT_SCHEDULING_PARAMS: SchedulingParams = {
  dayCapHours: 8,
  nightPriority: 50,
  eveningPriority: 25,
  repeatStartPenalty: 0,
  minRestHours: 8,
  preferredRestHours: 10,
  maxConsecutiveDays: 5,
  maxDaysPerWeek: 6,
  preferredDaysPerWeek: 5,
};

export const DAY_CAP_HOURS_MIN = 1;
export const DAY_CAP_HOURS_MAX = 16;
export const REPEAT_START_PENALTY_MIN = 0;
export const REPEAT_START_PENALTY_MAX = 100;
export const MIN_REST_HOURS_MIN = 4;
export const MIN_REST_HOURS_MAX = 16;
/** Preferred rest shares the 16h ceiling; its floor is the minRestHours value. */
export const PREFERRED_REST_HOURS_MAX = 16;
export const MAX_CONSECUTIVE_DAYS_MIN = 1;
export const MAX_CONSECUTIVE_DAYS_MAX = 14;
export const MAX_DAYS_PER_WEEK_MIN = 1;
export const MAX_DAYS_PER_WEEK_MAX = 7;
/** Preferred days' ceiling is the maxDaysPerWeek value. */
export const PREFERRED_DAYS_PER_WEEK_MIN = 1;

/** True when the value is fractional or outside [min, max]. */
const invalid = (value: number, min: number, max: number) =>
  !Number.isInteger(value) || value < min || value > max;

/** One UI-facing message covering every field, or null when the input is valid. */
export function validateSchedulingParams(p: SchedulingParams): string | null {
  if (invalid(p.dayCapHours, DAY_CAP_HOURS_MIN, DAY_CAP_HOURS_MAX)) {
    return `Max hours per day must be a whole number from ${DAY_CAP_HOURS_MIN} to ${DAY_CAP_HOURS_MAX}.`;
  }
  if (invalid(p.nightPriority, 0, 100) || invalid(p.eveningPriority, 0, 100)) {
    return "Priorities must be whole numbers from 0 to 100.";
  }
  if (invalid(p.repeatStartPenalty, REPEAT_START_PENALTY_MIN, REPEAT_START_PENALTY_MAX)) {
    return `Repeat start penalty must be a whole number from ${REPEAT_START_PENALTY_MIN} to ${REPEAT_START_PENALTY_MAX}.`;
  }
  if (invalid(p.minRestHours, MIN_REST_HOURS_MIN, MIN_REST_HOURS_MAX)) {
    return `Minimum rest hours must be a whole number from ${MIN_REST_HOURS_MIN} to ${MIN_REST_HOURS_MAX}.`;
  }
  if (invalid(p.preferredRestHours, MIN_REST_HOURS_MIN, PREFERRED_REST_HOURS_MAX)) {
    return `Preferred rest hours must be a whole number from ${MIN_REST_HOURS_MIN} to ${PREFERRED_REST_HOURS_MAX}.`;
  }
  if (p.preferredRestHours < p.minRestHours) {
    return "Preferred rest hours cannot be lower than minimum rest hours.";
  }
  if (invalid(p.maxConsecutiveDays, MAX_CONSECUTIVE_DAYS_MIN, MAX_CONSECUTIVE_DAYS_MAX)) {
    return `Max consecutive days must be a whole number from ${MAX_CONSECUTIVE_DAYS_MIN} to ${MAX_CONSECUTIVE_DAYS_MAX}.`;
  }
  if (invalid(p.maxDaysPerWeek, MAX_DAYS_PER_WEEK_MIN, MAX_DAYS_PER_WEEK_MAX)) {
    return `Max days per week must be a whole number from ${MAX_DAYS_PER_WEEK_MIN} to ${MAX_DAYS_PER_WEEK_MAX}.`;
  }
  if (invalid(p.preferredDaysPerWeek, PREFERRED_DAYS_PER_WEEK_MIN, MAX_DAYS_PER_WEEK_MAX)) {
    return `Preferred days per week must be a whole number from ${PREFERRED_DAYS_PER_WEEK_MIN} to ${MAX_DAYS_PER_WEEK_MAX}.`;
  }
  if (p.preferredDaysPerWeek > p.maxDaysPerWeek) {
    return "Preferred days per week cannot be higher than max days per week.";
  }
  return null;
}

/**
 * Parse the stored JSON. Missing fields backfill from the defaults first
 * (older stored values predate the labor fields); then, if the combined value
 * fails validation anywhere, including the cross-field rules, the WHOLE
 * stored value falls back to the defaults, not just the bad field. Never
 * throws: a corrupt setting must not take schedule generation down.
 */
export function parseSchedulingParams(raw: string | null): SchedulingParams {
  if (!raw) return DEFAULT_SCHEDULING_PARAMS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SCHEDULING_PARAMS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SCHEDULING_PARAMS;
  const candidate: SchedulingParams = {
    ...DEFAULT_SCHEDULING_PARAMS,
    ...(parsed as Partial<SchedulingParams>),
  };
  return validateSchedulingParams(candidate) === null ? candidate : DEFAULT_SCHEDULING_PARAMS;
}
