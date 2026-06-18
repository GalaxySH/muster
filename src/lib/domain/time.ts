/**
 * Time-of-day helpers for shift blocks.
 *
 * Times are represented internally as **minutes since midnight** (0–1439),
 * which makes overlap and duration math trivial. The human-facing notation
 * matches PLAN.md §6.3: `a` = am, `p` = pm, e.g. `6:45a`, `8p`, `11:30p`.
 */

/** A half-open time range [start, end) in minutes since midnight. */
export interface TimeRange {
  start: number;
  end: number;
}

const TIME_PATTERN = /^(\d{1,2})(?::(\d{2}))?([ap])$/;

/** Parse `6:45a` / `8p` notation into minutes since midnight. */
export function parseTime(value: string): number {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid time: "${value}" (expected e.g. "6:45a" or "8p")`);
  }
  const [, hourStr, minuteStr, meridiem] = match;
  let hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;

  if (hour < 1 || hour > 12) {
    throw new Error(`Invalid hour in time: "${value}" (1–12 expected)`);
  }
  if (minute > 59) {
    throw new Error(`Invalid minute in time: "${value}" (0–59 expected)`);
  }

  // 12a = midnight (0), 12p = noon (720); otherwise add 12h for pm.
  if (hour === 12) hour = 0;
  if (meridiem === "p") hour += 12;

  return hour * 60 + minute;
}

/** Format minutes since midnight back into `6:45a` / `8p` notation. */
export function formatTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new Error(`Invalid minutes-since-midnight: ${minutes}`);
  }
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const meridiem = hour24 < 12 ? "a" : "p";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;

  const minutePart = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${hour12}${minutePart}${meridiem}`;
}

/** Duration of a range in minutes. */
export function minutesBetween(range: TimeRange): number {
  return range.end - range.start;
}

/** True if two ranges share any interior time. Touching endpoints don't count. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}
