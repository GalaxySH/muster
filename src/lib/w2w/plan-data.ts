import "server-only";

/**
 * Server-side data layer for the W2W shift plan
 * (docs/w2w-shift-plan-roundtrip.md). Only raw plan rows are stored; matching
 * against blocks and the position map is recomputed here on every read, so
 * edits on /admin/positions or a remapped position show up immediately
 * instead of leaving stale resolutions in the DB.
 */
import { asc, count, eq, max } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  positions,
  shiftBlocks,
  shiftPlans,
  shiftPlanRows,
  w2wEmployees,
  w2wPositionMap,
} from "@/lib/db/schema";
import { matchPlan } from "@/lib/domain/w2w-plan/match";
import type {
  MatchBlock,
  PlanMatchReport,
  W2wPlanRow,
  W2wPositionMapEntry,
} from "@/lib/domain/w2w-plan/types";

export interface PlanMeta {
  id: string;
  importedAt: Date;
  importedBy: string;
  sourceFilename: string;
  rowCount: number;
}

export interface CurrentPlan {
  meta: PlanMeta;
  rows: W2wPlanRow[];
}

/** Matching inputs loaded fresh from config: the map and the block set. */
export interface PlanMatchInputs {
  map: W2wPositionMapEntry[];
  blocks: MatchBlock[];
  positionNames: Map<string, string>;
}

export async function loadPlanMatchInputs(): Promise<PlanMatchInputs> {
  const db = getDb();
  const [mapRows, blockRows, positionRows] = await Promise.all([
    db.select().from(w2wPositionMap),
    db.select().from(shiftBlocks),
    db.select({ id: positions.id, name: positions.name }).from(positions),
  ]);
  return {
    map: mapRows.map((m) => ({
      w2wPositionId: m.w2wPositionId,
      w2wPositionName: m.w2wPositionName,
      musterPositionId: m.musterPositionId,
      fillOrder: m.fillOrder,
    })),
    blocks: blockRows.map((b) => ({
      id: b.id,
      positionId: b.positionId,
      dayType: b.dayType,
      startMinutes: b.startMinutes,
      endMinutes: b.endMinutes,
      desiredCapacity: b.desiredCapacity,
    })),
    positionNames: new Map(positionRows.map((p) => [p.id, p.name])),
  };
}

export async function getCurrentPlan(): Promise<CurrentPlan | null> {
  const db = getDb();
  const [meta] = await db
    .select()
    .from(shiftPlans)
    .where(eq(shiftPlans.status, "current"))
    .limit(1);
  if (!meta) return null;

  const rows = await db
    .select()
    .from(shiftPlanRows)
    .where(eq(shiftPlanRows.planId, meta.id))
    .orderBy(asc(shiftPlanRows.seq));

  return {
    meta: {
      id: meta.id,
      importedAt: meta.importedAt,
      importedBy: meta.importedBy,
      sourceFilename: meta.sourceFilename,
      rowCount: meta.rowCount,
    },
    rows: rows.map(toDomainRow),
  };
}

/** Stored row -> the pure domain shape matching and filling consume. */
export function toDomainRow(r: typeof shiftPlanRows.$inferSelect): W2wPlanRow {
  return {
    seq: r.seq,
    w2wPositionId: r.w2wPositionId,
    w2wPositionName: r.w2wPositionName,
    category: r.category,
    description: r.description,
    day: r.day,
    startTime: r.startTime,
    endTime: r.endTime,
    duration: r.duration,
    startMinutes: r.startMinutes,
    endMinutes: r.endMinutes,
    employeeName: r.importedEmployeeName,
    employeeNumber: r.importedEmployeeNumber,
  };
}

export interface W2wEmployeesStatus {
  total: number;
  importedAt: Date | null;
}

/** How many W2W names are on file and when they were last refreshed. */
export async function getW2wEmployeesStatus(): Promise<W2wEmployeesStatus> {
  const db = getDb();
  const [row] = await db
    .select({ n: count(), at: max(w2wEmployees.importedAt) })
    .from(w2wEmployees);
  return { total: row?.n ?? 0, importedAt: row?.at ?? null };
}

export interface PlanPageModel {
  meta: PlanMeta;
  report: PlanMatchReport;
  /** Row counts per W2W position name, source order preserved. */
  perPosition: { name: string; rows: number }[];
  /** Rows that arrived with an employee name already on them. */
  assignedRowCount: number;
  positionNames: Record<string, string>;
}

/** Everything the plan page renders about the current plan, matched live. */
export async function getPlanPageModel(): Promise<PlanPageModel | null> {
  const plan = await getCurrentPlan();
  if (!plan) return null;
  const inputs = await loadPlanMatchInputs();
  const report = matchPlan(plan.rows, inputs.map, inputs.blocks);

  const perPosition: { name: string; rows: number }[] = [];
  const seen = new Map<string, number>();
  for (const row of plan.rows) {
    const at = seen.get(row.w2wPositionName);
    if (at === undefined) {
      seen.set(row.w2wPositionName, perPosition.length);
      perPosition.push({ name: row.w2wPositionName, rows: 1 });
    } else {
      perPosition[at]!.rows += 1;
    }
  }

  return {
    meta: plan.meta,
    report,
    perPosition,
    assignedRowCount: plan.rows.filter((r) => r.employeeName !== "").length,
    positionNames: Object.fromEntries(inputs.positionNames),
  };
}
