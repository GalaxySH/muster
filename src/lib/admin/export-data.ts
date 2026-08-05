/**
 * Server-side bulk loader for the responses export (PLAN.md §10). Pulls every
 * submission plus its selections, flags, travel, and extracurricular proofs in
 * a handful of `IN` queries (response volume ~400), then hands plain
 * `ExportAggregate`s to the pure builders in `export.ts`. Order matches the
 * response list (by display name) for a stable sheet/CSV.
 */
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { partitionSelection } from "@/lib/domain/orphans";
import { getDb } from "@/lib/db";
import {
  positions,
  shiftBlocks,
  students,
  submissions,
  shiftSelections,
  internalAvailability,
  flags,
  travelRequests,
  extracurricularFiles,
} from "@/lib/db/schema";
import { toDomainBlock } from "@/lib/db/mappers";
import type { Position, SelectedShift, ShiftBlock } from "@/lib/domain/types";
import type { ExportAggregate, ExportTravel } from "./export";

const toIsoDate = (d: Date | string): string =>
  typeof d === "string" ? d : d.toISOString().slice(0, 10);

export async function loadExportData(): Promise<ExportAggregate[]> {
  const db = getDb();

  const base = await db
    .select({
      submissionId: submissions.id,
      status: submissions.status,
      scheduled: submissions.scheduled,
      desiredHours: submissions.desiredHours,
      everyWeekendOptIn: submissions.everyWeekendOptIn,
      submittedAt: submissions.submittedAt,
      updatedAt: submissions.updatedAt,
      studentNotes: submissions.studentNotes,
      schedulerNotes: submissions.schedulerNotes,
      courseScheduleFileId: submissions.courseScheduleFileId,
      extracurricularNotes: submissions.extracurricularNotes,
      email: students.email,
      displayName: students.displayName,
      international: students.international,
      onRoster: students.onRoster,
      positionId: students.positionId,
      positionName: positions.name,
      minHours: positions.minHours,
      minDays: positions.minDays,
      weekendExempt: positions.weekendExempt,
    })
    .from(submissions)
    .innerJoin(students, eq(submissions.studentEmail, students.email))
    .leftJoin(positions, eq(students.positionId, positions.id))
    // Exclude people moved to "People Leaving" from the export/running sheet
    // (PLAN §4.2); their submission stays in the DB but isn't a live response.
    .where(eq(students.onRoster, true))
    .orderBy(asc(students.displayName), asc(submissions.studentEmail));

  if (base.length === 0) return [];

  const subIds = base.map((b) => b.submissionId);
  const positionIds = [...new Set(base.map((b) => b.positionId).filter((p): p is string => !!p))];

  const [blockRows, selRows, internalRows, flagRows, travelRows, ecRows] = await Promise.all([
    positionIds.length
      ? db
          .select()
          .from(shiftBlocks)
          .where(and(inArray(shiftBlocks.positionId, positionIds), isNull(shiftBlocks.retiredAt)))
      : Promise.resolve([]),
    db.select().from(shiftSelections).where(inArray(shiftSelections.submissionId, subIds)),
    db
      .select({ submissionId: internalAvailability.submissionId })
      .from(internalAvailability)
      .where(inArray(internalAvailability.submissionId, subIds)),
    db.select().from(flags).where(inArray(flags.submissionId, subIds)),
    db.select().from(travelRequests).where(inArray(travelRequests.submissionId, subIds)),
    db
      .select()
      .from(extracurricularFiles)
      .where(inArray(extracurricularFiles.submissionId, subIds)),
  ]);

  // The sheet keeps showing the student's own answers; this marker says an
  // internal copy exists, so a row is never silently different from what the
  // scheduler actually schedules against.
  const internalSubIds = new Set(internalRows.map((r) => r.submissionId));

  const blocksByPosition = new Map<string, ShiftBlock[]>();
  for (const row of blockRows) {
    const list = blocksByPosition.get(row.positionId) ?? [];
    list.push(toDomainBlock(row));
    blocksByPosition.set(row.positionId, list);
  }

  const selectionBySub = new Map<string, SelectedShift[]>();
  const autoBySub = new Map<string, SelectedShift[]>();
  for (const s of selRows) {
    const target = s.autoAssigned ? autoBySub : selectionBySub;
    const list = target.get(s.submissionId) ?? [];
    list.push({ blockId: s.shiftBlockId, day: s.day });
    target.set(s.submissionId, list);
  }

  const flagsBySub = new Map<string, { type: string; detail: string }[]>();
  for (const f of flagRows) {
    const list = flagsBySub.get(f.submissionId) ?? [];
    list.push({ type: f.type, detail: f.detail ?? "" });
    flagsBySub.set(f.submissionId, list);
  }

  const travelBySub = new Map<string, ExportTravel[]>();
  for (const t of travelRows) {
    const list = travelBySub.get(t.submissionId) ?? [];
    list.push({
      startDate: toIsoDate(t.startDate),
      endDate: toIsoDate(t.endDate),
      excused: t.excused,
      note: t.note ?? null,
      proofFileId: t.proofFileId,
    });
    travelBySub.set(t.submissionId, list);
  }

  const ecBySub = new Map<string, string[]>();
  for (const e of ecRows) {
    const list = ecBySub.get(e.submissionId) ?? [];
    list.push(e.fileId);
    ecBySub.set(e.submissionId, list);
  }

  return base.map((b) => {
    const position: Position | null =
      b.positionId && b.minHours != null && b.minDays != null
        ? {
            id: b.positionId,
            name: b.positionName ?? b.positionId,
            minHours: b.minHours,
            minDays: b.minDays,
            weekendExempt: b.weekendExempt ?? false,
          }
        : null;

    const blocks = b.positionId ? (blocksByPosition.get(b.positionId) ?? []) : [];
    // Drop picks on removed shifts before the export does any arithmetic with
    // them: `blocks` is live-only, and computeCapacity throws on a block it
    // can't resolve. They are not availability, so they don't belong in the
    // exported hours or day counts either.
    const selection = partitionSelection(selectionBySub.get(b.submissionId) ?? [], blocks).known;
    const autoAssigned = partitionSelection(autoBySub.get(b.submissionId) ?? [], blocks).known;

    return {
      email: b.email,
      displayName: b.displayName,
      international: b.international,
      onRoster: b.onRoster,
      positionName: b.positionName ?? null,
      position,
      blocks,
      status: b.status,
      scheduled: b.scheduled,
      desiredHours: b.desiredHours,
      everyWeekendOptIn: b.everyWeekendOptIn,
      submittedAt: b.submittedAt,
      updatedAt: b.updatedAt,
      studentNotes: b.studentNotes ?? "",
      schedulerNotes: b.schedulerNotes ?? "",
      selection,
      autoAssigned,
      internalAdjusted: internalSubIds.has(b.submissionId),
      flags: flagsBySub.get(b.submissionId) ?? [],
      courseScheduleFileId: b.courseScheduleFileId ?? null,
      extracurricularNotes: b.extracurricularNotes ?? "",
      extracurricularFileIds: ecBySub.get(b.submissionId) ?? [],
      travel: travelBySub.get(b.submissionId) ?? [],
    } satisfies ExportAggregate;
  });
}
