/**
 * The admin hub's view model (roadmap 4.1): pure derivation from one snapshot.
 *
 * `dashboard.ts` does the I/O and hands the raw counts here; this module owns
 * every policy decision the hub makes — what counts as a problem, how bad it
 * is, what order the problems appear in, who is worth nudging, which shift
 * blocks look thin. No I/O, no DB, no env, so the whole "what does the admin
 * see today" question is unit-testable against a plain object.
 *
 * The alert list is the point of the page: it renders ONLY what is actually
 * wrong. An empty list is the good day, not a broken page.
 */
import { windowState, type WindowState } from "@/lib/domain/window";
import { REQUIRED_CLOSE_CLAIMS } from "@/lib/domain/close-claims";
import { DIGEST_STALE_HOURS } from "@/lib/changes/digest-health";
import { FLAG_LABELS } from "./response-filters";
import type { DbFlagType } from "@/lib/db/schema";

/** A draft nobody has touched in this long is stalled, not in progress. */
export const STALLED_DRAFT_DAYS = 3;
/** How many of the thinnest blocks the coverage panel lists. */
export const COVERAGE_ROWS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type Severity = "danger" | "warning";

export interface DashboardAlert {
  /** Stable key; also what the tests assert on. */
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  href: string;
  linkLabel: string;
}

/** One on-roster student, joined to their submission if they have one. */
export interface DashboardStudent {
  email: string;
  displayName: string;
  positionId: string | null;
  groupId: string | null;
  /** null when they never started the form. */
  status: "draft" | "submitted" | null;
  scheduled: boolean;
  hasCourseSchedule: boolean;
  /** Submission's last edit; null when they never started. */
  updatedAt: Date | null;
}

export interface DashboardGroup {
  id: string;
  name: string;
  opensAt: Date | null;
  closesAt: Date | null;
}

/** One (block, day) cell and how many students picked it themselves. */
export interface CoverageCell {
  blockId: string;
  day: string;
  positionName: string;
  startMinutes: number;
  endMinutes: number;
  /** Derived from the position's day-type bounds, never hardcoded (PLAN §6.3). */
  isOpen: boolean;
  isClose: boolean;
  takers: number;
}

export interface RecentSubmission {
  email: string;
  displayName: string;
  positionName: string | null;
  submittedAt: Date;
  flagTypes: DbFlagType[];
}

export interface DashboardSnapshot {
  /** On-roster students only. Off-roster people are not the admin's work. */
  students: DashboardStudent[];
  groups: DashboardGroup[];
  changeRequests: { open: number; oldestCreatedAt: Date | null; newLast24h: number };
  flagCounts: { type: DbFlagType; count: number }[];
  travelCount: number;
  closes: {
    hasInventory: boolean;
    leadsTotal: number;
    leadsShort: number;
    required: number;
    available: number;
    feasible: boolean;
  };
  drive: { connected: boolean; email: string | null; lastOkAt: Date | null };
  sheet: { url: string | null; lastSyncedAt: Date | null };
  email: {
    sendingEnabled: boolean;
    digestEnabled: boolean;
    recipientCount: number;
    digestLastRun: Date | null;
  };
  ghostTitles: { title: string | null; count: number }[];
  roster: {
    onRoster: number;
    offRoster: number;
    lastImport: { importedAt: Date; rowCount: number; importedBy: string } | null;
  };
  coverage: CoverageCell[];
  recent: RecentSubmission[];
  perDay: { date: string; count: number }[];
}

export interface GroupProgress {
  id: string;
  name: string;
  state: WindowState;
  opensAt: Date | null;
  closesAt: Date | null;
  memberCount: number;
  submitted: number;
  draft: number;
}

export interface DashboardView {
  totals: {
    onRoster: number;
    submitted: number;
    draft: number;
    notStarted: number;
    /** Whole-percent submitted, 0 when the roster is empty. */
    percent: number;
  };
  groups: GroupProgress[];
  /** On-roster students with no group: they cannot open the form at all. */
  ungrouped: number;
  alerts: DashboardAlert[];
  tiles: {
    toReview: number;
    changeRequests: { open: number; newLast24h: number; oldestDays: number | null };
    flags: { total: number; byType: { type: DbFlagType; label: string; count: number }[] };
    travel: number;
    closes: { leadsShort: number; leadsTotal: number; overCapacity: number } | null;
  };
  nudge: {
    stalledDraftEmails: string[];
    neverStartedEmails: string[];
    missingCourseSchedule: number;
  };
  /** The thinnest blocks, worst first, plus the healthiest count for bar scaling. */
  coverage: { cells: CoverageCell[]; max: number };
  recent: RecentSubmission[];
  perDay: { date: string; count: number }[];
}

const daysBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/**
 * The whole hub in one pass. `now` is injected so the window states, the
 * stalled-draft cutoff, and the digest staleness check are all testable.
 */
export function buildDashboardView(snapshot: DashboardSnapshot, now: Date): DashboardView {
  const { students, groups } = snapshot;

  const submitted = students.filter((s) => s.status === "submitted");
  const drafts = students.filter((s) => s.status === "draft");
  const notStarted = students.filter((s) => s.status === null);
  const ungrouped = students.filter((s) => s.groupId === null).length;

  const onRoster = students.length;
  const totals = {
    onRoster,
    submitted: submitted.length,
    draft: drafts.length,
    notStarted: notStarted.length,
    percent: onRoster === 0 ? 0 : Math.round((submitted.length / onRoster) * 100),
  };

  const groupProgress: GroupProgress[] = groups.map((g) => {
    const members = students.filter((s) => s.groupId === g.id);
    return {
      id: g.id,
      name: g.name,
      state: windowState(g.opensAt, g.closesAt, now),
      opensAt: g.opensAt,
      closesAt: g.closesAt,
      memberCount: members.length,
      submitted: members.filter((s) => s.status === "submitted").length,
      draft: members.filter((s) => s.status === "draft").length,
    };
  });

  const stalledCutoff = new Date(now.getTime() - STALLED_DRAFT_DAYS * DAY_MS);
  const stalledDraftEmails = drafts
    .filter((s) => s.updatedAt !== null && s.updatedAt < stalledCutoff)
    .map((s) => s.email);

  const flagTotal = snapshot.flagCounts.reduce((n, f) => n + f.count, 0);
  const flagsByType = snapshot.flagCounts
    .filter((f) => f.count > 0)
    .map((f) => ({ type: f.type, label: FLAG_LABELS[f.type], count: f.count }))
    .sort((a, b) => b.count - a.count);

  // Before anyone has picked anything, every block sits at zero and the ranking
  // is noise: five arbitrary blocks tied at 0 say nothing about coverage. No
  // signal, no panel.
  const coverageMax = snapshot.coverage.reduce((n, c) => Math.max(n, c.takers), 0);
  const coverageCells =
    coverageMax === 0
      ? []
      : [...snapshot.coverage]
          .sort((a, b) => a.takers - b.takers || a.positionName.localeCompare(b.positionName))
          .slice(0, COVERAGE_ROWS);

  const oldestDays =
    snapshot.changeRequests.oldestCreatedAt === null
      ? null
      : daysBetween(snapshot.changeRequests.oldestCreatedAt, now);

  return {
    totals,
    groups: groupProgress,
    ungrouped,
    alerts: buildAlerts(snapshot, now, { ungrouped, groupProgress }),
    tiles: {
      toReview: submitted.filter((s) => !s.scheduled).length,
      changeRequests: {
        open: snapshot.changeRequests.open,
        newLast24h: snapshot.changeRequests.newLast24h,
        oldestDays,
      },
      flags: { total: flagTotal, byType: flagsByType },
      travel: snapshot.travelCount,
      closes: snapshot.closes.hasInventory
        ? {
            leadsShort: snapshot.closes.leadsShort,
            leadsTotal: snapshot.closes.leadsTotal,
            overCapacity: Math.max(0, snapshot.closes.required - snapshot.closes.available),
          }
        : null,
    },
    nudge: {
      stalledDraftEmails,
      neverStartedEmails: notStarted.map((s) => s.email),
      missingCourseSchedule: drafts.filter((s) => !s.hasCourseSchedule).length,
    },
    coverage: { cells: coverageCells, max: coverageMax },
    recent: snapshot.recent,
    perDay: snapshot.perDay,
  };
}

/**
 * Everything wrong right now, worst first. Each alert names the thing and links
 * to where it gets fixed; nothing is emitted for a healthy subsystem.
 *
 * The dangers are the states that silently stop a student from submitting at
 * all (no Drive, no group, no window) or that mean stored data is now wrong
 * (failed revalidation, a dead digest cron). Warnings are things the admin
 * should get to, not things that are actively losing responses.
 */
function buildAlerts(
  s: DashboardSnapshot,
  now: Date,
  ctx: { ungrouped: number; groupProgress: GroupProgress[] },
): DashboardAlert[] {
  const danger: DashboardAlert[] = [];
  const warning: DashboardAlert[] = [];

  if (!s.drive.connected) {
    danger.push({
      id: "drive-disconnected",
      severity: "danger",
      title: "Google Drive is not connected.",
      detail: "Students cannot upload their course schedule or any other proof.",
      href: "/admin/drive",
      linkLabel: "Drive",
    });
  }

  if (ctx.ungrouped > 0) {
    danger.push({
      id: "ungrouped-students",
      severity: "danger",
      title: `${ctx.ungrouped} ${plural(ctx.ungrouped, "student is", "students are")} in no group, so the form will not open for them.`,
      href: "/admin/groups",
      linkLabel: "Groups",
    });
  }

  const unconfigured = ctx.groupProgress.filter(
    (g) => g.state === "unconfigured" && g.memberCount > 0,
  );
  for (const g of unconfigured) {
    danger.push({
      id: `window-unconfigured-${g.id}`,
      severity: "danger",
      title: `${g.name} has no form window set, so its ${g.memberCount} ${plural(g.memberCount, "member", "members")} cannot open the form.`,
      href: "/admin/groups",
      linkLabel: "Groups",
    });
  }

  const digestAge = s.email.digestLastRun ? now.getTime() - s.email.digestLastRun.getTime() : null;
  const digestStale = digestAge === null || digestAge > DIGEST_STALE_HOURS * HOUR_MS;
  if (
    s.changeRequests.open > 0 &&
    s.email.digestEnabled &&
    s.email.recipientCount > 0 &&
    digestStale
  ) {
    danger.push({
      id: "digest-stale",
      severity: "danger",
      title:
        digestAge === null
          ? "The change-request digest has never run."
          : `The change-request digest has not run in ${Math.floor(digestAge / DAY_MS)} ${plural(Math.floor(digestAge / DAY_MS), "day", "days")}.`,
      detail: `${s.changeRequests.open} open ${plural(s.changeRequests.open, "request is", "requests are")} waiting. Check the cron job on the server.`,
      href: "/admin/email-settings",
      linkLabel: "Email",
    });
  }

  const failed = s.flagCounts.find((f) => f.type === "revalidation_failed")?.count ?? 0;
  if (failed > 0) {
    danger.push({
      id: "revalidation-failed",
      severity: "danger",
      title: `${failed} submitted ${plural(failed, "response", "responses")} no longer ${plural(failed, "passes", "pass")} validation.`,
      detail: "Their shift blocks changed after they submitted.",
      href: "/admin/responses?flag=revalidation_failed",
      linkLabel: "Review",
    });
  }

  if (s.closes.hasInventory && !s.closes.feasible) {
    warning.push({
      id: "closes-infeasible",
      severity: "warning",
      title: `Close inventory covers ${s.closes.available} of the ${s.closes.required} claims shift leads need.`,
      href: "/admin/closes",
      linkLabel: "Closes",
    });
  }
  if (s.closes.hasInventory && s.closes.leadsShort > 0) {
    warning.push({
      id: "closes-short",
      severity: "warning",
      title: `${s.closes.leadsShort} shift ${plural(s.closes.leadsShort, "lead is", "leads are")} short of ${REQUIRED_CLOSE_CLAIMS} weekend closes.`,
      href: "/admin/closes",
      linkLabel: "Closes",
    });
  }

  if (s.ghostTitles.length > 0) {
    const named = s.ghostTitles
      .map((g) => g.title)
      .filter((t): t is string => Boolean(t))
      .slice(0, 3)
      .join(", ");
    warning.push({
      id: "ghost-titles",
      severity: "warning",
      title: `${s.ghostTitles.length} roster ${plural(s.ghostTitles.length, "title is", "titles are")} not mapped to a position.`,
      detail: named ? `${named}. Those students cannot pick shifts.` : undefined,
      href: "/admin/positions",
      linkLabel: "Positions",
    });
  }

  if (!s.email.sendingEnabled) {
    warning.push({
      id: "email-off",
      severity: "warning",
      title: "Outbound email is switched off.",
      detail: "Sign-in links and schedule emails will not send.",
      href: "/admin/email-settings",
      linkLabel: "Email",
    });
  } else if (s.email.digestEnabled && s.email.recipientCount === 0) {
    warning.push({
      id: "digest-no-recipients",
      severity: "warning",
      title: "The change-request digest has no recipients, so it never sends.",
      href: "/admin/email-settings",
      linkLabel: "Email",
    });
  }

  if (s.roster.lastImport === null) {
    warning.push({
      id: "no-roster",
      severity: "warning",
      title: "No roster has been imported yet.",
      href: "/admin/roster",
      linkLabel: "Roster",
    });
  }

  return [...danger, ...warning];
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
