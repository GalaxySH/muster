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
  /**
   * 0 ignores repeats; 100 pushes hardest against the same start time again.
   * Tuned to 20 against a production availability snapshot (P5 of
   * docs/generator-constraints-fairness-plan.md): it was the smallest value on
   * the sweep that broke up lockstep pairs and tightened the hours spread
   * without costing seats.
   */
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
  /**
   * Positions that cover for each other, so a returner on one is real backup
   * for the other. Read only by the run statistics (./stats.ts), which measure
   * them as a single floor; the engine never looks at this. Ids that no longer
   * exist simply match nothing.
   */
  coveragePoolPositionIds: string[];
}

/**
 * Frozen, object and pool array alike. Two callers hand this exact value out:
 * `parseSchedulingParams` returns it for an unreadable setting, and
 * `storedSchedulingParams` spreads it, which copies the array BY REFERENCE into
 * every params value that omits a pool. One `push` anywhere would then edit the
 * default for the whole process. Nothing mutates it today; freezing is what
 * keeps that true.
 */
export const DEFAULT_SCHEDULING_PARAMS: SchedulingParams = Object.freeze({
  dayCapHours: 8,
  nightPriority: 50,
  eveningPriority: 25,
  repeatStartPenalty: 20,
  minRestHours: 8,
  preferredRestHours: 10,
  maxConsecutiveDays: 5,
  maxDaysPerWeek: 6,
  preferredDaysPerWeek: 5,
  coveragePoolPositionIds: Object.freeze(["culinary-assistant", "cashier"]) as string[],
});

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
  // Runtime shape check, not just a type: this arrives from stored JSON and
  // from the form. Unknown ids are fine (they match no position), a value that
  // is not a list of ids is not.
  if (
    !Array.isArray(p.coveragePoolPositionIds) ||
    p.coveragePoolPositionIds.some((id) => typeof id !== "string" || id.trim() === "")
  ) {
    return "Pick the cross-coverage positions from the list.";
  }
  return null;
}

/**
 * A stored, possibly partial params value made whole. Missing fields backfill
 * from the defaults (older stored values predate the labor fields); then, if
 * the combined value fails validation anywhere, including the cross-field
 * rules, the WHOLE value falls back to the defaults rather than just the bad
 * field. Half-validated knobs are worse than known ones: a stored pair like
 * min rest 12 with preferred rest 4 is incoherent, and judging a run against
 * it would produce findings nobody can act on.
 */
export function storedSchedulingParams(p: Partial<SchedulingParams> | undefined): SchedulingParams {
  const candidate: SchedulingParams = { ...DEFAULT_SCHEDULING_PARAMS, ...p };
  return validateSchedulingParams(candidate) === null ? candidate : DEFAULT_SCHEDULING_PARAMS;
}

/**
 * Parse the stored JSON into params. Never throws: a corrupt setting must not
 * take schedule generation down, so anything unreadable is the defaults, and
 * anything readable goes through `storedSchedulingParams`.
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
  return storedSchedulingParams(parsed as Partial<SchedulingParams>);
}
