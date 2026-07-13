/**
 * Server-side data for the admin surfaces (PLAN.md §10, §10a).
 *
 * The per-student view is the primary admin surface: it pulls a student's
 * roster record, position config, submission, selection (split into the
 * student's own picks vs. the machine-assigned weekend cell), persisted flags,
 * and evidence (Drive fileIds only, never bytes, via the evidence loader).
 *
 * The response list is the navigation hub; it also defines the stable ordering
 * the per-student prev/next nav walks (PLAN §10 "fast prev/next", hard req).
 */
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  changeRequests,
  groups,
  positions,
  shiftBlocks,
  students,
  submissions,
  shiftSelections,
  travelRequests,
  flags,
  type DbFlagType,
} from "@/lib/db/schema";
import { toDomainPosition, toDomainBlock } from "@/lib/db/mappers";
import { normalizeEmail } from "@/lib/auth/policy";
import { loadEvidence, type EvidenceView } from "@/lib/evidence/data";
import { TEST_GROUP_ID } from "@/lib/test-accounts/constants";
import { applyResponseFilters, type ResponseFilters } from "./response-filters";
import { upcomingTravel, type TravelWeek } from "./upcoming-travel";
import type { Position, ShiftBlock, SelectedShift } from "@/lib/domain/types";

export interface StudentDetail {
  email: string;
  displayName: string;
  international: boolean;
  onRoster: boolean;
  position: Position | null;
  blocks: ShiftBlock[];
  submission: {
    id: string;
    status: "draft" | "submitted";
    /** Set when the student confirmed who they are on `/me`; null on an
     *  admin-created stub. Feed it to `responseStatus`, never `status` alone. */
    confirmedAt: Date | null;
    everyWeekendOptIn: boolean;
    desiredHours: number | null;
    studentNotes: string;
    submittedAt: Date | null;
    updatedAt: Date;
    scheduled: boolean;
    schedulerNotes: string;
  } | null;
  /** The student's own picks (machine-assigned cells excluded). */
  selection: SelectedShift[];
  /** Weekend cell(s) auto-assigned on submit (PLAN §5 #5). */
  autoAssigned: SelectedShift[];
  flags: { type: DbFlagType; detail: string }[];
  evidence: EvidenceView;
}

/** Everything the per-student view needs, or null if no such student. */
export async function loadStudentDetail(emailRaw: string): Promise<StudentDetail | null> {
  const db = getDb();
  const email = normalizeEmail(emailRaw);

  const [student] = await db.select().from(students).where(eq(students.email, email)).limit(1);
  if (!student) return null;

  let position: Position | null = null;
  let blocks: ShiftBlock[] = [];
  if (student.positionId) {
    const [posRow] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, student.positionId))
      .limit(1);
    if (posRow) {
      position = toDomainPosition(posRow);
      const blockRows = await db
        .select()
        .from(shiftBlocks)
        .where(eq(shiftBlocks.positionId, student.positionId));
      blocks = blockRows.map(toDomainBlock);
    }
  }

  const [subRow] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.studentEmail, email))
    .limit(1);

  let selection: SelectedShift[] = [];
  let autoAssigned: SelectedShift[] = [];
  let flagRows: { type: DbFlagType; detail: string }[] = [];
  let submission: StudentDetail["submission"] = null;

  if (subRow) {
    submission = {
      id: subRow.id,
      status: subRow.status,
      confirmedAt: subRow.confirmedAt,
      everyWeekendOptIn: subRow.everyWeekendOptIn,
      desiredHours: subRow.desiredHours,
      studentNotes: subRow.studentNotes ?? "",
      submittedAt: subRow.submittedAt,
      updatedAt: subRow.updatedAt,
      scheduled: subRow.scheduled,
      schedulerNotes: subRow.schedulerNotes ?? "",
    };

    const selRows = await db
      .select()
      .from(shiftSelections)
      .where(eq(shiftSelections.submissionId, subRow.id));
    selection = selRows
      .filter((r) => !r.autoAssigned)
      .map((r) => ({ blockId: r.shiftBlockId, day: r.day }));
    autoAssigned = selRows
      .filter((r) => r.autoAssigned)
      .map((r) => ({ blockId: r.shiftBlockId, day: r.day }));

    const fRows = await db
      .select({ type: flags.type, detail: flags.detail })
      .from(flags)
      .where(eq(flags.submissionId, subRow.id));
    flagRows = fRows.map((f) => ({ type: f.type, detail: f.detail ?? "" }));
  }

  const evidence = await loadEvidence(email);

  return {
    email: student.email,
    displayName: student.displayName,
    international: student.international,
    onRoster: student.onRoster,
    position,
    blocks,
    submission,
    selection,
    autoAssigned,
    flags: flagRows,
    evidence,
  };
}

/** Where a student stands, as the admin surfaces report it. */
export type ResponseStatus = "draft" | "submitted" | "missing";

/**
 * The one rule for "has this student engaged with the form?", shared by the
 * response list, non-response tracking, and the per-student header.
 *
 * A submission row alone does not mean the student started: admins can create a
 * stub (scheduler notes, an uploaded course schedule) for someone who never
 * showed up. `confirmedAt` is stamped only when the student confirms who they
 * are on `/me`, so it, not row existence, is the signal.
 */
export function responseStatus(
  row: { status: "draft" | "submitted" | null; confirmedAt: Date | null } | null,
): ResponseStatus {
  if (row?.status === "submitted") return "submitted";
  if (row?.status === "draft" && row.confirmedAt !== null) return "draft";
  return "missing";
}

export interface ResponseRow {
  email: string;
  displayName: string;
  positionId: string | null;
  positionName: string | null;
  /** "missing" = never started (no submission, or an admin-created stub). */
  status: ResponseStatus;
  scheduled: boolean;
  desiredHours: number | null;
  /** False for students no longer on the roster (badged in the list). */
  onRoster: boolean;
  /** Group membership, for the group filter (null = ungrouped). */
  groupId: string | null;
  /** Roster hire date, for the start-date filter (null when unknown). */
  hiredOn: Date | null;
  /** Flag types on this submission, for the flag filter + count. */
  flagTypes: DbFlagType[];
  flagCount: number;
  /** Open (unresolved, not withdrawn) change requests, badged next to the name. */
  openChangeRequests: number;
  submittedAt: Date | null;
  /** Null for students with no submission row. */
  updatedAt: Date | null;
}

/**
 * Every student matching `filters`, in the canonical nav order: by display name,
 * then email. Students with no submission are carried as `status: "missing"` and
 * are hidden unless the all-students switch is on, so the default view is still
 * the responses. This ordering is the source of truth for the per-student
 * prev/next walk, and the filters (PLAN §10, roadmap 2.2) apply here so the list
 * and the neighbor walk stay in lockstep.
 */
export async function listResponses(filters: ResponseFilters = {}): Promise<ResponseRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      email: students.email,
      displayName: students.displayName,
      positionId: students.positionId,
      positionName: positions.name,
      onRoster: students.onRoster,
      groupId: students.groupId,
      hiredOn: students.hiredOn,
      submissionId: submissions.id,
      status: submissions.status,
      confirmedAt: submissions.confirmedAt,
      scheduled: submissions.scheduled,
      desiredHours: submissions.desiredHours,
      submittedAt: submissions.submittedAt,
      updatedAt: submissions.updatedAt,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .leftJoin(positions, eq(students.positionId, positions.id))
    // Roster + never-started visibility are filter concerns: applyResponseFilters
    // hides off-roster students (PLAN §4.2) and students with no submission
    // unless the matching switch is on.
    .orderBy(asc(students.displayName), asc(students.email));

  // One follow-up query for the flag types keyed by submission, avoiding a
  // GROUP BY round-trip per row. (Roster volume is ~400; a single IN is fine.)
  const subIds = rows.map((r) => r.submissionId).filter((id): id is string => id !== null);
  const allFlags = subIds.length
    ? await db
        .select({ submissionId: flags.submissionId, type: flags.type })
        .from(flags)
        .where(inArray(flags.submissionId, subIds))
    : [];
  const flagTypesBySub = new Map<string, DbFlagType[]>();
  for (const f of allFlags) {
    const list = flagTypesBySub.get(f.submissionId) ?? [];
    list.push(f.type);
    flagTypesBySub.set(f.submissionId, list);
  }

  // Open change-request counts per student, one grouped query (same shape as
  // the flags lookup above; the list badges the count next to the name).
  const openRequests = await db
    .select({
      email: changeRequests.studentEmail,
      count: sql<number>`count(*)`,
    })
    .from(changeRequests)
    .where(eq(changeRequests.status, "open"))
    .groupBy(changeRequests.studentEmail);
  const openRequestsByEmail = new Map(openRequests.map((r) => [r.email, Number(r.count)]));

  const mapped: ResponseRow[] = rows.map((r) => {
    const flagTypes = (r.submissionId && flagTypesBySub.get(r.submissionId)) || [];
    return {
      email: r.email,
      displayName: r.displayName,
      positionId: r.positionId,
      positionName: r.positionName,
      status: responseStatus({ status: r.status, confirmedAt: r.confirmedAt }),
      scheduled: r.scheduled ?? false,
      desiredHours: r.desiredHours,
      onRoster: r.onRoster,
      groupId: r.groupId,
      hiredOn: r.hiredOn,
      flagTypes,
      flagCount: flagTypes.length,
      openChangeRequests: openRequestsByEmail.get(r.email) ?? 0,
      submittedAt: r.submittedAt,
      updatedAt: r.updatedAt,
    };
  });

  return applyResponseFilters(mapped, filters);
}

export interface RosterPerson {
  email: string;
  displayName: string;
  positionId: string | null;
  positionName: string | null;
  /** Raw PCPL title from the roster import, shown when no position is mapped. */
  rosterTitle: string | null;
}

export interface NonResponseReport {
  rosterTotal: number;
  respondedCount: number;
  /** Roster students who never started (no submission, or an admin-created stub). */
  noResponse: RosterPerson[];
  /** Roster students who started but haven't submitted. */
  draftOnly: RosterPerson[];
  /** Responders not on the current roster (gaps to note). */
  offRoster: RosterPerson[];
}

/**
 * Non-response tracking (PLAN §10): roster − responders, split into never-started
 * vs. draft-only, plus off-roster responders flagged separately. Buckets use the
 * shared `responseStatus` rule, so a stub row an admin created for a student who
 * never showed up stays in "no response" and keeps getting chased.
 */
export async function listNonResponses(): Promise<NonResponseReport> {
  const db = getDb();
  const rows = await db
    .select({
      email: students.email,
      displayName: students.displayName,
      onRoster: students.onRoster,
      groupId: students.groupId,
      positionId: students.positionId,
      positionName: positions.name,
      rosterTitle: students.rosterTitle,
      status: submissions.status,
      confirmedAt: submissions.confirmedAt,
    })
    .from(students)
    .leftJoin(submissions, eq(submissions.studentEmail, students.email))
    .leftJoin(positions, eq(students.positionId, positions.id))
    .orderBy(asc(students.displayName), asc(students.email));

  const noResponse: RosterPerson[] = [];
  const draftOnly: RosterPerson[] = [];
  const offRoster: RosterPerson[] = [];
  let rosterTotal = 0;
  let respondedCount = 0;

  for (const r of rows) {
    const person: RosterPerson = {
      email: r.email,
      displayName: r.displayName,
      positionId: r.positionId,
      positionName: r.positionName ?? null,
      rosterTitle: r.rosterTitle,
    };
    const status = responseStatus({ status: r.status, confirmedAt: r.confirmedAt });
    if (r.onRoster) {
      rosterTotal += 1;
      if (status === "submitted") respondedCount += 1;
      else if (status === "draft") draftOnly.push(person);
      else noResponse.push(person);
    } else if (status !== "missing" && r.groupId !== TEST_GROUP_ID) {
      // Admin-created test accounts are off-roster by design, not a roster gap.
      offRoster.push(person);
    }
  }

  return { rosterTotal, respondedCount, noResponse, draftOnly, offRoster };
}

export interface ResponseNeighbors {
  /** 1-based position in the list, or 0 if the email isn't in it. */
  index: number;
  total: number;
  prevEmail: string | null;
  nextEmail: string | null;
  /** The filtered students in nav order, for the header "jump to" menu. */
  people: { email: string; displayName: string }[];
}

/**
 * Prev/next email + position for the identity header nav (PLAN §10a). Walks the
 * same filtered list the response dashboard shows (roadmap 2.2), so the arrows
 * follow whatever filter is active.
 */
export async function getResponseNeighbors(
  emailRaw: string,
  filters: ResponseFilters = {},
): Promise<ResponseNeighbors> {
  const email = normalizeEmail(emailRaw);
  let list = await listResponses(filters);
  // The student you are looking at is always part of the walk: if the active
  // switches hide them, redo the list with both visibility switches on.
  if (!list.some((r) => r.email === email)) {
    list = await listResponses({ ...filters, includeMissing: true, includeOffRoster: true });
  }
  const people = list.map((r) => ({ email: r.email, displayName: r.displayName }));
  const i = list.findIndex((r) => r.email === email);
  if (i === -1) {
    return { index: 0, total: list.length, prevEmail: null, nextEmail: null, people };
  }
  return {
    index: i + 1,
    total: list.length,
    prevEmail: i > 0 ? list[i - 1]!.email : null,
    nextEmail: i < list.length - 1 ? list[i + 1]!.email : null,
    people,
  };
}

export interface UpcomingTravelEntry {
  id: string;
  studentEmail: string;
  studentName: string;
  positionName: string | null;
  startDate: string; // ISO yyyy-mm-dd (inclusive)
  endDate: string; // ISO yyyy-mm-dd (inclusive)
  note: string | null;
}

const toIsoDate = (d: Date | string): string =>
  typeof d === "string" ? d : d.toISOString().slice(0, 10);

/**
 * On-roster students' travel grouped into the current + next weeks (roadmap 2.3),
 * so the scheduler can see who is away each week. Every stored entry is excused by
 * construction (PLAN §8 late policy "refuse"). Pure bucketing in `upcoming-travel.ts`.
 */
export async function loadUpcomingTravel(
  now: Date = new Date(),
): Promise<TravelWeek<UpcomingTravelEntry>[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: travelRequests.id,
      studentEmail: submissions.studentEmail,
      studentName: students.displayName,
      positionName: positions.name,
      startDate: travelRequests.startDate,
      endDate: travelRequests.endDate,
      note: travelRequests.note,
    })
    .from(travelRequests)
    .innerJoin(submissions, eq(travelRequests.submissionId, submissions.id))
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .leftJoin(positions, eq(students.positionId, positions.id))
    .where(eq(students.onRoster, true))
    // Name order so same-day entries within a week bucket read alphabetically.
    .orderBy(asc(students.displayName), asc(students.email));

  const entries: UpcomingTravelEntry[] = rows.map((r) => ({
    id: r.id,
    studentEmail: r.studentEmail,
    studentName: r.studentName,
    positionName: r.positionName ?? null,
    startDate: toIsoDate(r.startDate),
    endDate: toIsoDate(r.endDate),
    note: r.note ?? null,
  }));

  return upcomingTravel(entries, now);
}

export interface ScheduleEmailRecipient {
  email: string;
  displayName: string;
}

export interface ScheduleEmailPreview {
  groupId: string;
  groupName: string;
  /** On-roster, submitted, scheduled members not yet emailed (the send targets). */
  recipients: ScheduleEmailRecipient[];
  /** Members already emailed (scheduleEmailSentAt set); skipped on re-run. */
  alreadyNotified: number;
}

/**
 * Who the "your schedule is ready" batch (roadmap 2.4) would email for a group:
 * on-roster members whose submission is submitted AND scheduled, split into those
 * not yet notified (recipients) vs. already emailed (skipped, idempotent re-runs).
 */
export async function loadScheduleEmailPreview(
  groupId: string,
): Promise<ScheduleEmailPreview | null> {
  const db = getDb();
  const [grp] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!grp) return null;

  const rows = await db
    .select({
      email: students.email,
      displayName: students.displayName,
      sentAt: submissions.scheduleEmailSentAt,
    })
    .from(students)
    .innerJoin(submissions, eq(submissions.studentEmail, students.email))
    .where(
      and(
        eq(students.groupId, groupId),
        eq(students.onRoster, true),
        eq(submissions.status, "submitted"),
        eq(submissions.scheduled, true),
      ),
    )
    .orderBy(asc(students.displayName), asc(students.email));

  const recipients = rows
    .filter((r) => r.sentAt === null)
    .map((r) => ({ email: r.email, displayName: r.displayName }));
  return {
    groupId,
    groupName: grp.name,
    recipients,
    alreadyNotified: rows.length - recipients.length,
  };
}
