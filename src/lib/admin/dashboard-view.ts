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
import { blockSetWarnings } from "@/lib/domain/config-validation";
import type { Position, ShiftBlock } from "@/lib/domain/types";
import { digestRunHealth } from "@/lib/changes/digest-health";
import { FLAG_LABELS } from "./response-filters";
import type { DbFlagType } from "@/lib/db/schema";
import { TEST_GROUP_ID } from "@/lib/test-accounts/constants";

/** A draft nobody has touched in this long is stalled, not in progress. */
export const STALLED_DRAFT_DAYS = 3;
/** How many of the thinnest blocks the coverage panel lists. */
export const COVERAGE_ROWS = 5;
/**
 * Travel starting within this many days that no one has marked resolved is worth
 * chasing: the scheduler is about to be short a person and has not accounted for it.
 */
export const IMMINENT_TRAVEL_DAYS = 2;
/**
 * A window that closed within this many days is still worth chasing (reopen,
 * follow up). Past it the alert would be permanent noise, so it drops off.
 */
export const RECENTLY_CLOSED_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** One on-roster travel entry in the near horizon (de-duped by id upstream). */
export interface DashboardTravel {
  studentName: string;
  startDate: string; // ISO yyyy-mm-dd (inclusive)
  endDate: string; // ISO yyyy-mm-dd (inclusive)
  /** Admin review marker; the imminent-travel alert fires only on unresolved trips. */
  resolved: boolean;
}

/**
 * One active, assignable position that has on-roster students, with its full
 * block set. The alert layer runs the pure `blockSetWarnings` over these to
 * catch a shift setup that silently blocks its students (no blocks, an
 * unreachable hour or day floor) or leaves a layout missing.
 */
export interface PositionConfig {
  position: Position;
  blocks: ShiftBlock[];
  /** On-roster students assigned to this position; always > 0 (empties are dropped). */
  onRosterCount: number;
}

export interface DashboardSnapshot {
  /** On-roster students only. Off-roster people are not the admin's work. */
  students: DashboardStudent[];
  groups: DashboardGroup[];
  changeRequests: { open: number; oldestCreatedAt: Date | null; newLast24h: number };
  flagCounts: { type: DbFlagType; count: number }[];
  /** On-roster travel in the near horizon, feeding both the tile count and the alert. */
  travel: DashboardTravel[];
  closes: {
    hasInventory: boolean;
    leadsTotal: number;
    leadsShort: number;
    required: number;
    available: number;
    feasible: boolean;
  };
  drive: {
    connected: boolean;
    email: string | null;
    lastOkAt: Date | null;
    /** Last Drive write that threw; a value newer than lastOkAt means it is down. */
    lastErrorAt: Date | null;
  };
  sheet: { url: string | null; lastSyncedAt: Date | null };
  /** The SL closes backup sheet; only meaningful once close inventory exists. */
  closesSheet: { lastSyncedAt: Date | null };
  email: {
    sendingEnabled: boolean;
    digestEnabled: boolean;
    recipientCount: number;
    digestLastRun: Date | null;
  };
  /** The in-app change-digest scheduler's liveness inputs (see digest-health). */
  scheduler: { enabled: boolean; uptimeMs: number };
  /** Environment/settings toggles the alert layer reads to catch silent misconfig. */
  config: {
    /** RESEND_API_KEY is set; when false, "sending on" still delivers nothing. */
    resendConfigured: boolean;
    /** DRIVE_FOLDER_ID is set; when false, uploads land in a personal Drive. */
    driveFolderConfigured: boolean;
    /** NODE_ENV === "production"; some misconfigs only bite (or only matter) in prod. */
    isProduction: boolean;
    /** Effective travel-excusal cutoff (admin value or the 9/1 default). */
    travelCutoff: Date;
  };
  ghostTitles: { title: string | null; count: number }[];
  positionConfigs: PositionConfig[];
  /** On-roster students whose position is now inactive or merged (not assignable). */
  nonAssignablePositions: { studentCount: number; positionNames: string[] };
  roster: {
    onRoster: number;
    offRoster: number;
    lastImport: {
      importedAt: Date;
      rowCount: number;
      importedBy: string;
      /** Rows skipped for a non-wisc.edu email; they never reached the roster. */
      skippedNonWisc: number;
    } | null;
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

/** The UTC calendar day of `d` as ISO yyyy-mm-dd (matches the travel date storage). */
const isoDayUtc = (d: Date): string => d.toISOString().slice(0, 10);

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

  // A reminder only helps a student whose window is open right now: nudging
  // someone whose window has not opened (they cannot start) or has already closed
  // (they are locked out) points the admin at people they cannot help.
  const openGroupIds = new Set(groupProgress.filter((g) => g.state === "open").map((g) => g.id));
  const inOpenWindow = (s: DashboardStudent) => s.groupId !== null && openGroupIds.has(s.groupId);

  const stalledCutoff = new Date(now.getTime() - STALLED_DRAFT_DAYS * DAY_MS);
  const stalledDraftEmails = drafts
    .filter((s) => s.updatedAt !== null && s.updatedAt < stalledCutoff)
    .filter(inOpenWindow)
    .map((s) => s.email);
  const neverStartedEmails = notStarted.filter(inOpenWindow).map((s) => s.email);

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
    // Never a real cohort to track progress on; keep it out of the response-progress
    // table (it still shows on /admin/groups, where its window is managed).
    groups: groupProgress.filter((g) => g.id !== TEST_GROUP_ID),
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
      travel: snapshot.travel.length,
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
      neverStartedEmails,
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
  } else if (
    s.drive.lastErrorAt !== null &&
    (s.drive.lastOkAt === null || s.drive.lastErrorAt > s.drive.lastOkAt)
  ) {
    // The grant row still exists (so "connected" reads true), but the most recent
    // Drive write threw after the last one that worked: the grant is failing,
    // usually because it was revoked at Google.
    danger.push({
      id: "drive-failing",
      severity: "danger",
      title: "Google Drive uploads are failing.",
      detail: "The grant may have been revoked. Reconnect Drive so uploads work again.",
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

  // The scheduler stamps every run (even no-op ones), so a missing or stale
  // stamp means the scheduler itself is dead, independent of whether a request
  // is waiting. That is why this is NOT gated on the open queue: a dead
  // scheduler stops all future catch-up, so it must surface even on a quiet day
  // (the startup grace inside digestRunHealth covers a just-booted process).
  const digestHealth = digestRunHealth({
    schedulerEnabled: s.scheduler.enabled,
    lastRunAt: s.email.digestLastRun,
    uptimeMs: s.scheduler.uptimeMs,
    now,
  });
  if (digestHealth === "never-ran" || digestHealth === "stale") {
    const days =
      s.email.digestLastRun !== null
        ? Math.floor((now.getTime() - s.email.digestLastRun.getTime()) / DAY_MS)
        : null;
    const waiting =
      s.changeRequests.open > 0
        ? ` ${s.changeRequests.open} open ${plural(s.changeRequests.open, "request is", "requests are")} waiting.`
        : "";
    danger.push({
      id: "digest-stale",
      severity: "danger",
      title:
        days === null
          ? "The change-request digest scheduler has never run."
          : `The change-request digest has not run in ${days} ${plural(days, "day", "days")}.`,
      detail: `The scheduler should run daily.${waiting} Check the app logs on the server.`,
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

  // A position's shift setup can silently block every student assigned to it: no
  // blocks to pick, or a block set that can never reach the hour or day floor.
  // Only positions with on-roster students are checked (an unused position is
  // not costing anyone a submission), and the pure `blockSetWarnings` is the
  // same check the positions editor shows.
  for (const pc of s.positionConfigs) {
    const warnings = blockSetWarnings(pc.position, pc.blocks);
    if (warnings.length === 0) continue;

    const affected = `${pc.onRosterCount} ${plural(pc.onRosterCount, "student", "students")}`;
    const blocking = warnings.some(
      (w) => w.kind === "min_hours_unreachable" || w.kind === "min_days_unreachable",
    );
    const missing = [
      warnings.some((w) => w.kind === "no_weekday_blocks") ? "weekday" : null,
      warnings.some((w) => w.kind === "no_weekend_blocks") ? "weekend" : null,
    ].filter((m): m is string => m !== null);

    const alert: DashboardAlert = {
      id: `position-config-${pc.position.id}`,
      severity: blocking ? "danger" : "warning",
      title:
        pc.blocks.length === 0
          ? `${pc.position.name} has no shift blocks, so its ${affected} cannot pick anything.`
          : blocking
            ? `${pc.position.name}'s shift blocks leave its ${affected} unable to submit.`
            : `${pc.position.name} is missing ${missing.join(" and ")} shift blocks.`,
      // The title already says it all when there are no blocks; otherwise the
      // warning messages carry the specifics (how short of the floor, etc.).
      detail: pc.blocks.length === 0 ? undefined : warnings.map((w) => w.message).join(" "),
      href: "/admin/positions",
      linkLabel: "Positions",
    };
    (blocking ? danger : warning).push(alert);
  }

  // Sending is on but there is no Resend key, so every message (sign-in links,
  // schedule emails, the digest) is only logged. Production only: dev leaves the
  // key empty on purpose, and the System status row reads a healthy "sending on".
  if (s.config.isProduction && s.email.sendingEnabled && !s.config.resendConfigured) {
    danger.push({
      id: "email-no-key",
      severity: "danger",
      title: "Email is on but no Resend key is set, so nothing actually sends.",
      detail: "Sign-in links and schedule emails are only written to the server log.",
      href: "/admin/email-settings",
      linkLabel: "Email",
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
    // Lead with the head count, not the number of titles: a cohort of 40 whose
    // title never stored collapses into one null-title bucket, and "1 title"
    // badly understates 40 students who cannot pick a single shift.
    const affected = s.ghostTitles.reduce((n, g) => n + g.count, 0);
    const named = s.ghostTitles
      .map((g) => g.title)
      .filter((t): t is string => Boolean(t))
      .slice(0, 3)
      .join(", ");
    warning.push({
      id: "ghost-titles",
      severity: "warning",
      title: `${affected} on-roster ${plural(affected, "student has", "students have")} a roster title with no position.`,
      detail: named
        ? `They cannot pick shifts until it is mapped. Titles: ${named}.`
        : "They cannot pick shifts until it is mapped.",
      href: "/admin/positions",
      linkLabel: "Positions",
    });
  }

  if (s.nonAssignablePositions.studentCount > 0) {
    const n = s.nonAssignablePositions.studentCount;
    const named = s.nonAssignablePositions.positionNames.slice(0, 3).join(", ");
    warning.push({
      id: "nonassignable-position-students",
      severity: "warning",
      title: `${n} on-roster ${plural(n, "student is", "students are")} on a position that is no longer assignable.`,
      detail: named ? `${named}. Reassign them or reactivate the position.` : undefined,
      href: "/admin/positions",
      linkLabel: "Positions",
    });
  }

  // A connected grant with no destination folder puts every upload in the
  // granting admin's personal Drive instead of the shared folder. Only meaningful
  // once Drive is connected; otherwise the drive-disconnected danger covers it.
  if (s.drive.connected && !s.config.driveFolderConfigured) {
    warning.push({
      id: "drive-folder-unset",
      severity: "warning",
      title: "Uploads are going to a personal Google Drive, not the shared folder.",
      detail: "Set the Drive folder so proofs and the running sheets land in the shared space.",
      href: "/admin/drive",
      linkLabel: "Drive",
    });
  }

  // Responses exist but the running sheet has never been written, so folder
  // members reading the sheet see nothing. It syncs after each submission, so a
  // null stamp with submissions in hand means the sync is not getting through.
  if (s.students.some((st) => st.status === "submitted") && s.sheet.lastSyncedAt === null) {
    warning.push({
      id: "responses-sheet-unsynced",
      severity: "warning",
      title: "The responses sheet has never synced.",
      detail: "Folder members cannot see any responses in it yet.",
      href: "/admin/drive",
      linkLabel: "Drive",
    });
  }

  if (s.closes.hasInventory && s.closesSheet.lastSyncedAt === null) {
    warning.push({
      id: "closes-sheet-unsynced",
      severity: "warning",
      title: "The weekend closes sheet has never synced.",
      detail: "The close-claims backup for folder members is missing.",
      href: "/admin/closes",
      linkLabel: "Closes",
    });
  }

  // Once the travel cutoff has passed the travel step refuses every new entry. If
  // a form window is still open, students are actively hitting that wall, which
  // usually means the cutoff was set too early.
  if (now >= s.config.travelCutoff && ctx.groupProgress.some((g) => g.state === "open")) {
    warning.push({
      id: "travel-cutoff-past",
      severity: "warning",
      title: "The travel cutoff has passed, so students can no longer add travel.",
      detail: "A form window is still open. Move the cutoff later if this is too early.",
      href: "/admin/groups",
      linkLabel: "Groups",
    });
  }

  // Travel starting within the next couple of days that no one has ticked
  // resolved: the scheduler is about to be short a person and has not accounted
  // for it. ISO date strings compare lexicographically, matching the UTC day the
  // upcoming-travel list buckets by.
  const todayIso = isoDayUtc(now);
  const horizonIso = isoDayUtc(new Date(now.getTime() + IMMINENT_TRAVEL_DAYS * DAY_MS));
  const imminent = s.travel.filter(
    (t) => !t.resolved && t.startDate >= todayIso && t.startDate <= horizonIso,
  );
  if (imminent.length > 0) {
    const n = imminent.length;
    const names = [...new Set(imminent.map((t) => t.studentName))];
    const named = names.slice(0, 3).join(", ");
    warning.push({
      id: "travel-imminent-unresolved",
      severity: "warning",
      title: `${n} travel ${plural(n, "entry starts", "entries start")} in the next ${IMMINENT_TRAVEL_DAYS} days and ${plural(n, "is", "are")} not marked resolved.`,
      detail: `${named}. Mark each resolved once its schedule is set.`,
      href: "/admin/travel",
      linkLabel: "Travel",
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

  // A window that just closed with members who never submitted is the moment to
  // act (reopen, chase them). Only recently closed windows, so it clears itself.
  const closedShort = ctx.groupProgress.filter(
    (g) =>
      g.state === "closed" &&
      g.submitted < g.memberCount &&
      g.closesAt !== null &&
      now.getTime() - g.closesAt.getTime() <= RECENTLY_CLOSED_DAYS * DAY_MS,
  );
  if (closedShort.length > 0) {
    const total = closedShort.reduce((n, g) => n + (g.memberCount - g.submitted), 0);
    const named = closedShort
      .slice(0, 3)
      .map((g) => `${g.name} (${g.memberCount - g.submitted})`)
      .join(", ");
    warning.push({
      id: "closed-window-shortfall",
      severity: "warning",
      title: `${total} ${plural(total, "student", "students")} never submitted before their window closed.`,
      detail: `${named}. They stay locked out unless you reopen the window.`,
      href: "/admin/non-responses",
      linkLabel: "Missing",
    });
  }

  // A roster email Google will not accept (not wisc.edu) locks that student out
  // of sign-in entirely; being on the roster is what would have let them in.
  const nonWisc = s.students.filter((st) => {
    const domain = st.email.split("@")[1]?.toLowerCase();
    return domain !== undefined && domain !== "wisc.edu";
  }).length;
  if (nonWisc > 0) {
    warning.push({
      id: "non-wisc-emails",
      severity: "warning",
      title: `${nonWisc} roster ${plural(nonWisc, "email is", "emails are")} not a wisc.edu address.`,
      detail: "Those students cannot sign in with Google and may be locked out of the form.",
      href: "/admin/roster",
      linkLabel: "Roster",
    });
  }

  // The importer skips non-wisc.edu rows (they could never sign in), so a real
  // worker entered with a wrong email silently never lands on the roster. The
  // count rides on the last import's audit row, so it clears on a clean re-import.
  if (s.roster.lastImport && s.roster.lastImport.skippedNonWisc > 0) {
    const n = s.roster.lastImport.skippedNonWisc;
    warning.push({
      id: "import-skipped-non-wisc",
      severity: "warning",
      title: `The last roster import skipped ${n} non-wisc.edu ${plural(n, "email", "emails")}.`,
      detail: "Those people are not on the roster. Fix the email to a wisc.edu address and re-import.",
      href: "/admin/roster",
      linkLabel: "Roster",
    });
  }

  // A dotted wisc.edu local part is almost always a name alias, not the NetID
  // Google returns at sign-in, so the student is never matched to their roster row.
  const aliasEmails = s.students.filter((st) => {
    const [local, domain] = st.email.toLowerCase().split("@");
    return domain === "wisc.edu" && (local?.includes(".") ?? false);
  }).length;
  if (aliasEmails > 0) {
    warning.push({
      id: "alias-emails",
      severity: "warning",
      title: `${aliasEmails} roster ${plural(aliasEmails, "email looks", "emails look")} like a name alias, not a NetID.`,
      detail: "Google returns the NetID at sign-in, so these students may not be recognized.",
      href: "/admin/roster",
      linkLabel: "Roster",
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
