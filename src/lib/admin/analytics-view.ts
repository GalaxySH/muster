/**
 * Pure derivation for the login analytics surface (`/admin/analytics`).
 *
 * Reads one thin row per on-roster student and answers "who has logged in, who
 * hasn't, and how recently". `last_seen_at` is stamped on any authenticated
 * activity (lib/auth/last-seen.ts), so a null value means the person has never
 * signed in. All bucketing is here so it stays testable without a DB.
 */

export interface AnalyticsStudent {
  email: string;
  displayName: string;
  /** Most recent authenticated activity; null = never signed in. */
  lastSeenAt: Date | null;
  /** Their submission status, or null when they have no submission row. */
  status: "draft" | "submitted" | null;
}

export interface RecencyBuckets {
  /** Active in the last 24 hours. */
  today: number;
  /** Active in the last 7 days (excludes today). */
  week: number;
  /** Active in the last 30 days (excludes the last 7). */
  month: number;
  /** Signed in at some point, but not in the last 30 days. */
  dormant: number;
}

export interface AnalyticsView {
  /** On-roster students. */
  total: number;
  everSignedIn: number;
  neverSignedIn: number;
  /** Share of the roster that has ever signed in, rounded to a whole percent. */
  signedInPercent: number;
  /**
   * The roster split into three mutually exclusive stages, most-engaged last:
   * never signed in → signed in but not submitted → submitted.
   */
  funnel: { neverSignedIn: number; signedInNotSubmitted: number; submitted: number };
  /** How recently the signed-in people were last active (sums to everSignedIn). */
  recency: RecencyBuckets;
  /** How many students were last active on each of the last 14 days, oldest first. */
  perDay: { date: string; count: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_DAYS = 14;

/** UTC calendar day of `d` as ISO yyyy-mm-dd. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildAnalyticsView(students: AnalyticsStudent[], now: Date): AnalyticsView {
  const nowMs = now.getTime();
  let everSignedIn = 0;
  const funnel = { neverSignedIn: 0, signedInNotSubmitted: 0, submitted: 0 };
  const recency: RecencyBuckets = { today: 0, week: 0, month: 0, dormant: 0 };

  // Seed one bucket per day for the last window, oldest first, so a quiet day
  // still shows as zero rather than dropping out of the series.
  const perDay = new Map<string, number>();
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    perDay.set(isoDay(new Date(nowMs - i * DAY_MS)), 0);
  }

  for (const s of students) {
    // Funnel: submitted wins, then any sign-in, then never.
    if (s.status === "submitted") funnel.submitted += 1;
    else if (s.lastSeenAt) funnel.signedInNotSubmitted += 1;
    else funnel.neverSignedIn += 1;

    if (s.lastSeenAt) {
      everSignedIn += 1;
      const ageMs = nowMs - s.lastSeenAt.getTime();
      if (ageMs < DAY_MS) recency.today += 1;
      else if (ageMs < 7 * DAY_MS) recency.week += 1;
      else if (ageMs < 30 * DAY_MS) recency.month += 1;
      else recency.dormant += 1;

      const day = isoDay(s.lastSeenAt);
      if (perDay.has(day)) perDay.set(day, perDay.get(day)! + 1);
    }
  }

  const total = students.length;
  return {
    total,
    everSignedIn,
    neverSignedIn: total - everSignedIn,
    signedInPercent: total === 0 ? 0 : Math.round((everSignedIn / total) * 100),
    funnel,
    recency,
    perDay: [...perDay].map(([date, count]) => ({ date, count })),
  };
}
