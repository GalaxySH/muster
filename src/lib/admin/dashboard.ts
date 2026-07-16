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
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  changeRequests,
  flags,
  groups,
  positions,
  shiftBlocks,
  shiftSelections,
  students,
  submissions,
  type DbFlagType,
} from "@/lib/db/schema";
import { WEEKDAY_DAYS, WEEKEND_DAYS } from "@/lib/domain/types";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { getRosterStatus } from "@/lib/roster/status";
import { hasCloseInventory, loadCloseAdmin } from "@/lib/closes/data";
import {
  getChangeDigestEnabled,
  getChangeDigestLastRun,
  getChangeDigestRecipients,
  getDriveLastOkAt,
  getEmailSendingEnabled,
} from "@/lib/settings";
import { getLastSheetSync, getSheetUrl, RESPONSES_SHEET } from "./sheet-sync";
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
    travelCount,
    closes,
    drive,
    driveLastOkAt,
    sheetUrl,
    sheetSyncedAt,
    sendingEnabled,
    digestEnabled,
    digestRecipients,
    digestLastRun,
    roster,
    coverage,
    recent,
    perDay,
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
    loadTravelCount(now),
    loadCloses(),
    getDriveGrantStatus(),
    getDriveLastOkAt(),
    getSheetUrl(RESPONSES_SHEET),
    getLastSheetSync(RESPONSES_SHEET),
    getEmailSendingEnabled(),
    getChangeDigestEnabled(),
    getChangeDigestRecipients(),
    getChangeDigestLastRun(),
    getRosterStatus(),
    loadCoverage(),
    loadRecentSubmissions(),
    loadSubmissionsPerDay(now),
  ]);

  return {
    students: studentRows,
    groups: groupRows,
    changeRequests: changeRequestRow,
    flagCounts,
    travelCount,
    closes,
    drive: { connected: drive.connected, email: drive.email ?? null, lastOkAt: driveLastOkAt },
    sheet: { url: sheetUrl, lastSyncedAt: sheetSyncedAt },
    email: {
      sendingEnabled,
      digestEnabled,
      recipientCount: digestRecipients.length,
      digestLastRun,
    },
    ghostTitles: roster.ghostTitles,
    roster: {
      onRoster: roster.onRoster,
      offRoster: roster.offRoster,
      lastImport: roster.lastImport,
    },
    coverage,
    recent,
    perDay,
  };
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
 * entry in every week it straddles, so the buckets are de-duplicated by id
 * rather than summed.
 */
async function loadTravelCount(now: Date): Promise<number> {
  const weeks = await loadUpcomingTravel(now);
  const ids = new Set(weeks.flatMap((w) => w.entries.map((e) => e.id)));
  return ids.size;
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
 * thin weekend coverage this panel exists to show.
 *
 * Cells nobody picked are the whole point, and a GROUP BY cannot return them,
 * so the block × day grid is expanded here and the counts are laid over it.
 * Only positions that actually have on-roster students are included; an unused
 * position would otherwise sit at zero forever and crowd out real shortages.
 */
async function loadCoverage(): Promise<CoverageCell[]> {
  const db = getDb();
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
      .where(eq(positions.active, true)),
    db
      .select({
        blockId: shiftSelections.shiftBlockId,
        day: shiftSelections.day,
        n: sql<number>`count(distinct ${submissions.studentEmail})`,
      })
      .from(shiftSelections)
      .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(
        and(
          eq(submissions.status, "submitted"),
          eq(students.onRoster, true),
          eq(shiftSelections.autoAssigned, false),
        ),
      )
      .groupBy(shiftSelections.shiftBlockId, shiftSelections.day),
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
