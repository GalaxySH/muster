/**
 * Admin-tunable knobs for the schedule engine (docs/schedule-generation-plan.md
 * §3.2), edited on /admin/schedule and stored as one JSON app_settings value.
 *
 * The priorities blend lateness into the scarcity score instead of dominating
 * it: a cell's pull is its unmet share of target plus the tier's priority/100.
 * So 0 fills all targeted cells evenly, 100 reproduces fill-nights-completely-
 * first, and the default 50 keeps night cells running about half a target
 * ahead while mornings still get coverage.
 */
export interface SchedulingParams {
  /** Most merged hours the engine puts on one student's single day. */
  dayCapHours: number;
  /** 0 fills evenly; 100 fills night cells to target before anything else. */
  nightPriority: number;
  /** Same scale for evening cells; usually about half the night value. */
  eveningPriority: number;
}

export const DEFAULT_SCHEDULING_PARAMS: SchedulingParams = {
  dayCapHours: 8,
  nightPriority: 50,
  eveningPriority: 25,
};

export const DAY_CAP_HOURS_MIN = 1;
export const DAY_CAP_HOURS_MAX = 16;

/** One UI-facing message covering every field, or null when the input is valid. */
export function validateSchedulingParams(p: SchedulingParams): string | null {
  if (
    !Number.isInteger(p.dayCapHours) ||
    p.dayCapHours < DAY_CAP_HOURS_MIN ||
    p.dayCapHours > DAY_CAP_HOURS_MAX
  ) {
    return `Max hours per day must be a whole number from ${DAY_CAP_HOURS_MIN} to ${DAY_CAP_HOURS_MAX}.`;
  }
  for (const value of [p.nightPriority, p.eveningPriority]) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return "Priorities must be whole numbers from 0 to 100.";
    }
  }
  return null;
}

/**
 * Parse the stored JSON, falling back to the defaults for a missing value,
 * unparseable JSON, or any field that fails validation. Never throws: a
 * corrupt setting must not take schedule generation down.
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
