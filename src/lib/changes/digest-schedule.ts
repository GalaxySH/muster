/**
 * Pure scheduling rules for the in-app change-digest scheduler (no env, no
 * I/O; the tick loop in scheduler.ts applies them). The digest is due once a
 * day at DIGEST_SEND_HOUR in campus time, DST-correct: the send instant is
 * computed in America/Chicago, unlike the old fixed-UTC crontab. A run is due
 * whenever the last recorded run predates the most recent send instant, which
 * gives catch-up for free: if the app was down at send time, the first tick
 * after it comes back runs the digest.
 */

export const DIGEST_TIMEZONE = "America/Chicago";
/** Hour of day (campus time) the daily digest goes out. */
export const DIGEST_SEND_HOUR = 7;

/**
 * Whether the scheduler runs at all: always in production, and outside it
 * only behind an explicit flag ("1"/"true"). Keeps dev servers and Playwright
 * runs from spontaneously sending email against whatever DB they point at.
 */
export function isDigestSchedulerEnabled(
  devFlag: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv === "production") return true;
  return devFlag === "1" || devFlag === "true";
}

/** True when no run is recorded since the most recent scheduled send time. */
export function isDigestDue(lastRun: Date | null, now: Date): boolean {
  if (lastRun === null) return true;
  return lastRun.getTime() < mostRecentDigestSendInstant(now).getTime();
}

/** The latest daily send instant at or before `now` (7:00 campus time). */
export function mostRecentDigestSendInstant(now: Date): Date {
  const today = zonedDateParts(now);
  const todaysSend = zonedInstant(today.year, today.month, today.day, DIGEST_SEND_HOUR);
  if (todaysSend.getTime() <= now.getTime()) return todaysSend;
  // Before today's send time: the previous campus day's send. Stepping back
  // 24h stays within that day for any pre-7am wall clock, DST shifts included.
  const yesterday = zonedDateParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return zonedInstant(yesterday.year, yesterday.month, yesterday.day, DIGEST_SEND_HOUR);
}

/** The calendar date `instant` falls on in campus time. */
function zonedDateParts(instant: Date): { year: number; month: number; day: number } {
  // en-CA formats as yyyy-mm-dd.
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: DIGEST_TIMEZONE })
    .format(instant)
    .split("-");
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/**
 * The UTC instant of a campus-time wall clock (y-m-d h:00). Offset is looked
 * up at a first guess and then re-checked at the corrected instant, which
 * settles the guess that lands on the wrong side of a DST switch.
 */
function zonedInstant(year: number, month: number, day: number, hour: number): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour);
  const guessOffset = tzOffsetMs(new Date(wallAsUtc));
  const corrected = wallAsUtc - tzOffsetMs(new Date(wallAsUtc - guessOffset));
  return new Date(corrected);
}

/** Campus-time UTC offset (ms, negative west of UTC) at `instant`. */
function tzOffsetMs(instant: Date): number {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: DIGEST_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant)) {
    parts[p.type] = p.value;
  }
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return wallAsUtc - instant.getTime();
}
