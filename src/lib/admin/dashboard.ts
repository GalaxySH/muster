/**
 * Snapshot loader for the admin hub (roadmap 4.1).
 *
 * Every read here is either an aggregate or a small bounded list, and they all
 * run concurrently: the hub is the daily entry point, so it must not pay for
 * the row-heavy list loaders (`listResponses`, `listNonResponses`) that the
 * detail pages use.
 *
 * The one deliberate exception is the student roll: we load one thin row per
 * ON-ROSTER student (~400) instead of six separate COUNT queries. That keeps
 * the submitted/draft/never-started/ungrouped/stalled/no-schedule splits in one
 * pure, testable pass in `dashboard-view.ts`, and guarantees the hub's totals
 * cannot drift from /admin/non-responses, which filters the same way.
 *
 * All derivation lives in `dashboard-view.ts`. This module only fetches.
 */
import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { digestSchedulerEnabled, env } from "@/lib/env";
import {
  changeRequests,
  flags,
  groups,
  positions,
  shiftBlocks,
  students,
  submissions,
  type DbFlagType,
} from "@/lib/db/schema";
import { effectiveSelections } from "@/lib/availability/internal";
import { liveBlocksOnly } from "@/lib/db/blocks";
import { toDomainBlock, toDomainPosition } from "@/lib/db/mappers";
import { WEEKDAY_DAYS, WEEKEND_DAYS, type ShiftBlock } from "@/lib/domain/types";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { getRosterStatus } from "@/lib/roster/status";
import { hasCloseInventory, loadCloseAdmin } from "@/lib/closes/data";
import {
  getChangeDigestEnabled,
  getChangeDigestLastRun,
  getChangeDigestRecipients,
  getDriveLastError,
  getDriveLastOkAt,
  getEmailSendingEnabled,
  getTravelCutoff,
  getLateTravelPolicy,
} from "@/lib/settings";
import { loadCurrentRunRow, loadScheduleStaleness } from "@/lib/schedule/data";
import { getW2wMapIssues } from "@/lib/w2w/map-data";
import { CLOSES_SHEET, getLastSheetSync, getSheetUrl, RESPONSES_SHEET } from "./sheet-sync";
import { loadUpcomingTravel } from "./data";
import type {
  CoverageCell,
  DashboardSnapshot,
  DashboardStudent,
  RecentSubmission,
} from "./dashboard-view";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How much history the submissions sparkline shows. */
export const SPARKLINE_DAYS = 14;
/** How many of the newest submissions the hub lists. */
const RECENT_LIMIT = 5;

export async function loadAdminDashboard(now: Date = new Date()): Promise<DashboardSnapshot> {
  const [
    studentRows,
    groupRows,
    changeRequestRow,
    flagCounts,
    travel,
    closes,
    drive,
    driveLastOkAt,
    driveLastErrorAt,
    sheetUrl,
    sheetSyncedAt,
    closesSheetSyncedAt,
    sendingEnabled,
    digestEnabled,
    digestRecipients,
    digestLastRun,
    roster,
    positionConfigs,
    nonAssignablePositions,
    travelCutoff,
    lateTravelPolicy,
    coverage,
    recent,
    perDay,
    schedule,
    w2wMapIssues,
  ] = await Promise.all([
    loadStudentRoll(),
    getDb()
      .select({
        id: groups.id,
        name: groups.name,
        opensAt: groups.opensAt,
        closesAt: groups.closesAt,
      })
      .from(groups)
      .orderBy(asc(groups.name)),
    loadChangeRequestCounts(now),
    loadFlagCounts(),
    loadTravel(now),
    loadCloses(),
    getDriveGrantStatus(),
    getDriveLastOkAt(),
    getDriveLastError(),
    getSheetUrl(RESPONSES_SHEET),
    getLastSheetSync(RESPONSES_SHEET),
    getLastSheetSync(CLOSES_SHEET),
    getEmailSendingEnabled(),
    getChangeDigestEnabled(),
    getChangeDigestRecipients(),
    getChangeDigestLastRun(),
    getRosterStatus(),
    loadPositionConfigs(),
    loadNonAssignablePositions(),
    getTravelCutoff(now).then((r) => r.cutoff),
    getLateTravelPolicy(),
    loadCoverage(),
    loadRecentSubmissions(),
    loadSubmissionsPerDay(now),
    loadScheduleStatus(),
    getW2wMapIssues(),
  ]);

  return {
    students: studentRows,
    groups: groupRows,
    changeRequests: changeRequestRow,
    flagCounts,
    travel,
    closes,
    drive: {
      connected: drive.connected,
      email: drive.email ?? null,
      lastOkAt: driveLastOkAt,
      lastErrorAt: driveLastErrorAt,
    },
    sheet: { url: sheetUrl, lastSyncedAt: sheetSyncedAt },
    closesSheet: { lastSyncedAt: closesSheetSyncedAt },
    email: {
      sendingEnabled,
      digestEnabled,
      recipientCount: digestRecipients.length,
      digestLastRun,
    },
    scheduler: { enabled: digestSchedulerEnabled, uptimeMs: process.uptime() * 1000 },
    config: {
      resendConfigured: Boolean(env.RESEND_API_KEY),
      driveFolderConfigured: Boolean(env.DRIVE_FOLDER_ID),
      isProduction: process.env.NODE_ENV === "production",
      travelCutoff,
      lateTravelAccepted: lateTravelPolicy === "accept-and-flag",
    },
    ghostTitles: roster.ghostTitles,
    positionConfigs,
    nonAssignablePositions,
    roster: {
      onRoster: roster.onRoster,
      offRoster: roster.offRoster,
      lastImport: roster.lastImport,
    },
    coverage,
    recent,
    perDay,
    schedule,
    w2wMapIssues,
  };
}

/**
 * Whether a recommended schedule exists and how much eligible input has changed
 * since it was generated (feeds the hub's schedule-stale alert). Staleness is
 * measured from the run's generation time; restoring an old run does not make
 * its content any newer.
 */
async function loadScheduleStatus(): Promise<DashboardSnapshot["schedule"]> {
  const run = await loadCurrentRunRow();
  if (!run) return { hasRun: false, newSubmissions: 0, edited: 0 };
  const staleness = await loadScheduleStaleness(run.generatedAt);
  return { hasRun: true, ...staleness };
}

/**
 * One thin row per on-roster student, with their submission if any. The roster
 * predicate matches `listNonResponses` exactly (on_roster only), which is what
 * keeps the hub's headline numbers and the non-response page in agreement.
 */
async function loadStudentRoll(): Promise<DashboardStudent[]> {
  const rows = await getDb()
    .select({
      email: students.email,
      displayName: students.displayName,
      positionId: students.positionId,
      groupId: students.groupId,
      status: submissions.status,
      scheduled: submissions.scheduled,
      courseScheduleFileId: submissions.courseScheduleFileId,
      updatedAt: submissions.updatedAt,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .where(eq(students.onRoster, true))
    .orderBy(asc(students.displayName), asc(students.email));

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionId: r.positionId,
    groupId: r.groupId,
    status: r.status ?? null,
    scheduled: r.scheduled ?? false,
    hasCourseSchedule: Boolean(r.courseScheduleFileId),
    updatedAt: r.updatedAt ?? null,
  }));
}

/**
 * Every active, assignable position that has at least one on-roster student,
 * with its full block set, so the alert layer can run `blockSetWarnings` over a
 * config that is actually in use. Positions nobody is assigned to are dropped:
 * an unfinished setup on an unused position is not blocking anyone.
 */
async function loadPositionConfigs(): Promise<DashboardSnapshot["positionConfigs"]> {
  const db = getDb();
  const [posRows, blockRows, staffRows] = await Promise.all([
    db
      .select()
      .from(positions)
      .where(and(eq(positions.active, true), isNull(positions.mergedIntoId))),
    db.select().from(shiftBlocks).where(liveBlocksOnly()),
    db
      .select({ positionId: students.positionId, n: sql<number>`count(*)` })
      .from(students)
      .where(and(eq(students.onRoster, true), isNotNull(students.positionId)))
      .groupBy(students.positionId),
  ]);

  const staff = new Map(staffRows.map((r) => [r.positionId, Number(r.n)]));
  const blocksByPosition = new Map<string, ShiftBlock[]>();
  for (const b of blockRows) {
    const list = blocksByPosition.get(b.positionId) ?? [];
    list.push(toDomainBlock(b));
    blocksByPosition.set(b.positionId, list);
  }

  return posRows
    .map((p) => ({
      position: toDomainPosition(p),
      blocks: blocksByPosition.get(p.id) ?? [],
      onRosterCount: staff.get(p.id) ?? 0,
    }))
    .filter((pc) => pc.onRosterCount > 0);
}

/**
 * On-roster students still assigned to a position that is no longer assignable
 * (deactivated or merged into another). Their form still resolves the old blocks
 * by id, but they drop out of coverage and the picker, so this is a quiet drift
 * an admin needs to clean up. Grouped by position so the alert can name them.
 */
async function loadNonAssignablePositions(): Promise<DashboardSnapshot["nonAssignablePositions"]> {
  const rows = await getDb()
    .select({ name: positions.name, n: sql<number>`count(*)` })
    .from(students)
    .innerJoin(positions, eq(students.positionId, positions.id))
    .where(
      and(
        eq(students.onRoster, true),
        or(eq(positions.active, false), isNotNull(positions.mergedIntoId)),
      ),
    )
    .groupBy(positions.id, positions.name);

  const withCounts = rows.map((r) => ({ name: r.name, count: Number(r.n) }));
  return {
    studentCount: withCounts.reduce((sum, r) => sum + r.count, 0),
    positionNames: withCounts.sort((a, b) => b.count - a.count).map((r) => r.name),
  };
}

async function loadChangeRequestCounts(now: Date): Promise<DashboardSnapshot["changeRequests"]> {
  const cutoff = new Date(now.getTime() - DAY_MS);
  const [row] = await getDb()
    .select({
      open: sql<number>`count(*)`,
      oldest: sql<string | Date | null>`min(${changeRequests.createdAt})`,
      recent: sql<number>`sum(case when ${changeRequests.createdAt} >= ${cutoff} then 1 else 0 end)`,
    })
    .from(changeRequests)
    .where(eq(changeRequests.status, "open"));

  return {
    open: Number(row?.open ?? 0),
    oldestCreatedAt: row?.oldest ? new Date(row.oldest) : null,
    newLast24h: Number(row?.recent ?? 0),
  };
}

/** Flags on on-roster students only; off-roster people are not the admin's work. */
async function loadFlagCounts(): Promise<{ type: DbFlagType; count: number }[]> {
  const rows = await getDb()
    .select({ type: flags.type, n: sql<number>`count(*)` })
    .from(flags)
    .innerJoin(submissions, eq(flags.submissionId, submissions.id))
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(eq(students.onRoster, true))
    .groupBy(flags.type);
  return rows.map((r) => ({ type: r.type, count: Number(r.n) }));
}

/**
 * Distinct travel entries in the next three weeks. `upcomingTravel` repeats an
 * entry in every week it straddles, so the buckets are de-duplicated by id. The
 * flat list drives both the hub's travel tile count and its imminent-travel
 * alert (see `dashboard-view.ts`).
 */
async function loadTravel(now: Date): Promise<DashboardSnapshot["travel"]> {
  const weeks = await loadUpcomingTravel(now);
  const byId = new Map<string, DashboardSnapshot["travel"][number]>();
  for (const w of weeks) {
    for (const e of w.entries) {
      if (byId.has(e.id)) continue;
      byId.set(e.id, {
        studentName: e.studentName,
        startDate: e.startDate,
        endDate: e.endDate,
        resolved: e.resolved,
      });
    }
  }
  return [...byId.values()];
}

async function loadCloses(): Promise<DashboardSnapshot["closes"]> {
  if (!(await hasCloseInventory())) {
    return {
      hasInventory: false,
      leadsTotal: 0,
      leadsShort: 0,
      required: 0,
      available: 0,
      feasible: true,
    };
  }
  const view = await loadCloseAdmin();
  return {
    hasInventory: true,
    leadsTotal: view.leads.length,
    leadsShort: view.leads.filter((l) => !l.complete).length,
    required: view.feasibility.required,
    available: view.feasibility.available,
    feasible: view.feasibility.feasible,
  };
}

/**
 * How many students said yes to each (block, day) cell.
 *
 * Machine-assigned weekend cells are excluded: they are bodies the scheduler
 * gets anyway, not people who offered, and counting them would hide exactly the
 * thin weekend coverage this panel exists to show. Selections come through the
 * effective seam, so an internal copy replaces the student's own picks here
 * (internal cells are never machine-assigned, so they all count).
 *
 * Cells nobody picked are the whole point, and a GROUP BY cannot return them,
 * so the block × day grid is expanded here and the counts are laid over it.
 * Only positions that actually have on-roster students are included; an unused
 * position would otherwise sit at zero forever and crowd out real shortages.
 */
async function loadCoverage(): Promise<CoverageCell[]> {
  const db = getDb();
  const eff = effectiveSelections();
  const [blocks, takerRows, staffedPositions] = await Promise.all([
    db
      .select({
        id: shiftBlocks.id,
        positionId: shiftBlocks.positionId,
        positionName: positions.name,
        dayType: shiftBlocks.dayType,
        startMinutes: shiftBlocks.startMinutes,
        endMinutes: shiftBlocks.endMinutes,
      })
      .from(shiftBlocks)
      .innerJoin(positions, eq(shiftBlocks.positionId, positions.id))
      .where(and(eq(positions.active, true), liveBlocksOnly())),
    db
      .select({
        blockId: eff.shiftBlockId,
        day: eff.day,
        n: sql<number>`count(distinct ${submissions.studentEmail})`,
      })
      .from(eff)
      .innerJoin(submissions, eq(eff.submissionId, submissions.id))
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(
        and(
          eq(submissions.status, "submitted"),
          eq(students.onRoster, true),
          eq(eff.autoAssigned, false),
        ),
      )
      .groupBy(eff.shiftBlockId, eff.day),
    db
      .select({ positionId: students.positionId })
      .from(students)
      .where(and(eq(students.onRoster, true), isNotNull(students.positionId)))
      .groupBy(students.positionId),
  ]);

  const staffed = new Set(staffedPositions.map((p) => p.positionId));
  const takers = new Map(takerRows.map((r) => [`${r.blockId}|${r.day}`, Number(r.n)]));

  // Open/close are derived per position per day-type (PLAN §6.3), never stored.
  const bounds = new Map<string, { earliest: number; latest: number }>();
  for (const b of blocks) {
    const key = `${b.positionId}|${b.dayType}`;
    const cur = bounds.get(key);
    bounds.set(key, {
      earliest: Math.min(cur?.earliest ?? b.startMinutes, b.startMinutes),
      latest: Math.max(cur?.latest ?? b.endMinutes, b.endMinutes),
    });
  }

  const cells: CoverageCell[] = [];
  for (const b of blocks) {
    if (!staffed.has(b.positionId)) continue;
    const bound = bounds.get(`${b.positionId}|${b.dayType}`);
    const days = b.dayType === "weekday" ? WEEKDAY_DAYS : WEEKEND_DAYS;
    for (const day of days) {
      cells.push({
        blockId: b.id,
        day,
        positionName: b.positionName,
        startMinutes: b.startMinutes,
        endMinutes: b.endMinutes,
        isOpen: b.startMinutes === bound?.earliest,
        isClose: b.endMinutes === bound?.latest,
        takers: takers.get(`${b.id}|${day}`) ?? 0,
      });
    }
  }
  return cells;
}

async function loadRecentSubmissions(): Promise<RecentSubmission[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: submissions.id,
      email: submissions.studentEmail,
      displayName: students.displayName,
      positionName: positions.name,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .leftJoin(positions, eq(students.positionId, positions.id))
    .where(
      and(
        eq(submissions.status, "submitted"),
        eq(students.onRoster, true),
        isNotNull(submissions.submittedAt),
      ),
    )
    .orderBy(desc(submissions.submittedAt))
    .limit(RECENT_LIMIT);
  if (rows.length === 0) return [];

  const flagRows = await db
    .select({ submissionId: flags.submissionId, type: flags.type })
    .from(flags)
    .where(
      sql`${flags.submissionId} in (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`, `,
      )})`,
    );
  const byId = new Map<string, DbFlagType[]>();
  for (const f of flagRows) {
    byId.set(f.submissionId, [...(byId.get(f.submissionId) ?? []), f.type]);
  }

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    positionName: r.positionName ?? null,
    submittedAt: r.submittedAt!,
    flagTypes: byId.get(r.id) ?? [],
  }));
}

/**
 * A dense day-by-day count for the sparkline: the query returns only days that
 * had submissions, so the quiet days are filled back in here. A flat tail is
 * the signal worth seeing.
 */
async function loadSubmissionsPerDay(now: Date): Promise<{ date: string; count: number }[]> {
  const start = new Date(now.getTime() - (SPARKLINE_DAYS - 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);

  const rows = await getDb()
    .select({
      day: sql<string>`date(${submissions.submittedAt})`,
      n: sql<number>`count(*)`,
    })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .where(and(eq(students.onRoster, true), gte(submissions.submittedAt, start)))
    .groupBy(sql`date(${submissions.submittedAt})`);

  const counts = new Map(
    rows.map((r) => [
      typeof r.day === "string" ? r.day : new Date(r.day).toISOString().slice(0, 10),
      Number(r.n),
    ]),
  );

  return Array.from({ length: SPARKLINE_DAYS }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}
