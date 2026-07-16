/**
 * Server-side reads for the schedule coverage view (roadmap 5.1;
 * docs/schedule-generation-plan.md Phase A).
 *
 * Coverage counts who could be scheduled into each (block × day) cell, so it
 * counts every selection cell of a submitted on-roster student, including the
 * machine-assigned weekend cell (unlike the demand ranking, which reads
 * preferences and excludes it). Off-roster students drop out here the same way
 * they do everywhere else.
 */
import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions, shiftBlocks, shiftSelections, students, submissions } from "@/lib/db/schema";
import { toDomainBlock } from "@/lib/db/mappers";
import {
  buildCoverageRows,
  summarizeCoverage,
  type CoverageRow,
  type CoverageSummary,
} from "@/lib/domain/coverage";
import type { CellCount } from "@/lib/domain/demand";
import type { Day, ShiftBlock } from "@/lib/domain/types";

export interface PositionCoverage {
  positionId: string;
  positionName: string;
  weekendExempt: boolean;
  /** On-roster students holding this position. */
  rosterCount: number;
  /** Of those, how many have submitted. */
  responders: number;
  rows: CoverageRow[];
  summary: CoverageSummary;
}

/** Coverage for every active, non-alias position, ordered by name. */
export async function loadCoverage(): Promise<PositionCoverage[]> {
  const db = getDb();
  const onRosterSubmitted = and(
    eq(students.onRoster, true),
    eq(submissions.status, "submitted"),
  );
  const [posRows, blockRows, rosterRows, responderRows, cellRows] = await Promise.all([
    db
      .select()
      .from(positions)
      .where(and(eq(positions.active, true), isNull(positions.mergedIntoId)))
      .orderBy(asc(positions.name)),
    db.select().from(shiftBlocks),
    db
      .select({ positionId: students.positionId, n: sql<number>`count(*)` })
      .from(students)
      .where(eq(students.onRoster, true))
      .groupBy(students.positionId),
    db
      .select({ positionId: students.positionId, n: sql<number>`count(*)` })
      .from(submissions)
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(onRosterSubmitted)
      .groupBy(students.positionId),
    db
      .select({
        blockId: shiftSelections.shiftBlockId,
        day: shiftSelections.day,
        count: sql<number>`count(distinct ${shiftSelections.submissionId})`,
      })
      .from(shiftSelections)
      .innerJoin(submissions, eq(shiftSelections.submissionId, submissions.id))
      .innerJoin(students, eq(submissions.studentEmail, students.email))
      .where(onRosterSubmitted)
      .groupBy(shiftSelections.shiftBlockId, shiftSelections.day),
  ]);

  const rosterCount = new Map(rosterRows.map((r) => [r.positionId, Number(r.n)]));
  const responders = new Map(responderRows.map((r) => [r.positionId, Number(r.n)]));

  const blocksByPosition = new Map<string, ShiftBlock[]>();
  for (const row of blockRows) {
    const block = toDomainBlock(row);
    const list = blocksByPosition.get(block.positionId);
    if (list) list.push(block);
    else blocksByPosition.set(block.positionId, [block]);
  }

  const positionOfBlock = new Map(blockRows.map((b) => [b.id, b.positionId]));
  const countsByPosition = new Map<string, CellCount[]>();
  for (const row of cellRows) {
    const positionId = positionOfBlock.get(row.blockId);
    if (!positionId) continue;
    const cell: CellCount = { blockId: row.blockId, day: row.day as Day, count: Number(row.count) };
    const list = countsByPosition.get(positionId);
    if (list) list.push(cell);
    else countsByPosition.set(positionId, [cell]);
  }

  return posRows.map((p) => {
    const rows = buildCoverageRows(
      blocksByPosition.get(p.id) ?? [],
      countsByPosition.get(p.id) ?? [],
    );
    return {
      positionId: p.id,
      positionName: p.name,
      weekendExempt: p.weekendExempt,
      rosterCount: rosterCount.get(p.id) ?? 0,
      responders: responders.get(p.id) ?? 0,
      rows,
      summary: summarizeCoverage(rows),
    };
  });
}
