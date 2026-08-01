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
  /** Everyone who has never signed in, in roster order, for the follow-up list. */
  neverSignedInPeople: { email: string; displayName: string }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildAnalyticsView(students: AnalyticsStudent[], now: Date): AnalyticsView {
  const nowMs = now.getTime();
  let everSignedIn = 0;
  const funnel = { neverSignedIn: 0, signedInNotSubmitted: 0, submitted: 0 };
  const recency: RecencyBuckets = { today: 0, week: 0, month: 0, dormant: 0 };
  const neverSignedInPeople: { email: string; displayName: string }[] = [];

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
    } else {
      neverSignedInPeople.push({ email: s.email, displayName: s.displayName });
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
    neverSignedInPeople,
  };
}
