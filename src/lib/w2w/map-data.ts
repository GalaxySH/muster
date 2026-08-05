import "server-only";

/**
 * Server-side reads for the W2W position map surface
 * (docs/w2w-shift-plan-roundtrip.md §4). Everything is derived live from the
 * map, the position config, and the current plan, so an edit on either side
 * shows up immediately, the same way the plan report does.
 *
 * The plan is read as a per-position aggregate rather than by loading its
 * rows: a week is ~1000 of them and nothing here needs more than the counts.
 */
import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  positions,
  shiftBlocks,
  shiftPlanRows,
  shiftPlans,
  students,
  w2wEmployees,
  w2wPositionMap,
} from "@/lib/db/schema";
import {
  mapHealthIssues,
  type MapIssue,
  type MapTarget,
  type PlanPosition,
} from "@/lib/domain/w2w-plan/map-health";
import { buildMapResolver } from "@/lib/domain/w2w-plan/match";
import type { W2wPositionMapEntry } from "@/lib/domain/w2w-plan/types";

/** One editable mapping row. */
export interface W2wMapRow extends W2wPositionMapEntry {
  /** Null when the mapping points at a position that no longer exists. */
  musterPositionName: string | null;
  /** False when the current target is not a valid destination (gone, or an alias). */
  targetSelectable: boolean;
  /** Shifts in the current plan that resolve here; null when no plan. */
  planRowCount: number | null;
}

/** A position a mapping may point at. */
export interface MapPositionOption {
  id: string;
  name: string;
  active: boolean;
}

export interface CurrentPlanMeta {
  id: string;
  sourceFilename: string;
  importedAt: Date;
  rotationWeek: "a" | "b";
  rowCount: number;
}

export interface W2wMapPageModel {
  rows: W2wMapRow[];
  positionOptions: MapPositionOption[];
  issues: MapIssue[];
  /** W2W positions the current plan carries that nothing maps, for the add form. */
  unmapped: PlanPosition[];
  plan: CurrentPlanMeta | null;
}

interface MapHealthInputs {
  map: W2wPositionMapEntry[];
  targets: MapTarget[];
  planPositions: PlanPosition[] | null;
  plan: CurrentPlanMeta | null;
  nameById: Map<string, string>;
  positionRows: (typeof positions.$inferSelect)[];
}

/**
 * The map, what the position config knows about each target, and the current
 * plan's per-position shift counts. Shared by the page and the hub alert so
 * both judge the map by the same rules.
 */
async function loadMapHealthInputs(): Promise<MapHealthInputs> {
  const db = getDb();
  const [mapRows, positionRows, blockCountRows, planRows] = await Promise.all([
    // Ordered: resolution is first-wins by id and by name, so an unordered
    // read could resolve a duplicated name differently between requests.
    db.select().from(w2wPositionMap).orderBy(asc(w2wPositionMap.w2wPositionId)),
    db.select().from(positions),
    // Live blocks only: a retired block cannot match a plan row, so a position
    // whose blocks are all retired is as empty as one with none.
    db
      .select({
        positionId: shiftBlocks.positionId,
        n: sql<number>`count(*)`,
        weekend: sql<number>`sum(case when ${shiftBlocks.dayType} = 'weekend' then 1 else 0 end)`,
      })
      .from(shiftBlocks)
      .where(isNull(shiftBlocks.retiredAt))
      .groupBy(shiftBlocks.positionId),
    // Newest current plan. There is no unique constraint on status, so order
    // rather than trusting there to be exactly one.
    db
      .select()
      .from(shiftPlans)
      .where(eq(shiftPlans.status, "current"))
      .orderBy(desc(shiftPlans.importedAt))
      .limit(1),
  ]);

  const planRow = planRows[0];
  const plan: CurrentPlanMeta | null = planRow
    ? {
        id: planRow.id,
        sourceFilename: planRow.sourceFilename,
        importedAt: planRow.importedAt,
        rotationWeek: planRow.rotationWeek,
        rowCount: planRow.rowCount,
      }
    : null;

  // Grouped by id AND name: a W2W export may leave Position ID blank, and
  // grouping on the id alone would fold every such position into one synthetic
  // row whose name and counts belong to none of them.
  const planPositions: PlanPosition[] | null = plan
    ? (
        await db
          .select({
            w2wPositionId: shiftPlanRows.w2wPositionId,
            w2wPositionName: shiftPlanRows.w2wPositionName,
            n: sql<number>`count(*)`,
            weekend: sql<number>`sum(case when ${shiftPlanRows.day} in ('sat','sun') then 1 else 0 end)`,
          })
          .from(shiftPlanRows)
          .where(eq(shiftPlanRows.planId, plan.id))
          .groupBy(shiftPlanRows.w2wPositionId, shiftPlanRows.w2wPositionName)
      )
        .map((r) => ({
          w2wPositionId: r.w2wPositionId,
          w2wPositionName: r.w2wPositionName,
          rowCount: Number(r.n),
          weekendRowCount: Number(r.weekend ?? 0),
        }))
        .sort(
          (a, b) => b.rowCount - a.rowCount || a.w2wPositionName.localeCompare(b.w2wPositionName),
        )
    : null;

  const liveBlockCount = new Map(blockCountRows.map((r) => [r.positionId, Number(r.n)]));
  const liveWeekendBlockCount = new Map(
    blockCountRows.map((r) => [r.positionId, Number(r.weekend ?? 0)]),
  );
  const nameById = new Map(positionRows.map((p) => [p.id, p.name]));
  const targets: MapTarget[] = positionRows.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    mergedIntoId: p.mergedIntoId,
    mergedIntoName: p.mergedIntoId ? (nameById.get(p.mergedIntoId) ?? p.mergedIntoId) : null,
    liveBlockCount: liveBlockCount.get(p.id) ?? 0,
    liveWeekendBlockCount: liveWeekendBlockCount.get(p.id) ?? 0,
  }));

  const map: W2wPositionMapEntry[] = mapRows.map((m) => ({
    w2wPositionId: m.w2wPositionId,
    w2wPositionName: m.w2wPositionName,
    musterPositionId: m.musterPositionId,
    fillOrder: m.fillOrder,
  }));

  return { map, targets, planPositions, plan, nameById, positionRows };
}

export async function getW2wMapPageModel(): Promise<W2wMapPageModel> {
  const { map, targets, planPositions, plan, nameById, positionRows } = await loadMapHealthInputs();

  // Credit each plan position's rows to the entry that actually answered for
  // it, resolver and all, so a mapping matched by name is not reported as
  // holding zero shifts.
  const resolveEntry = buildMapResolver(map);
  const planRowCount = new Map<string, number>();
  const unmapped: PlanPosition[] = [];
  for (const p of planPositions ?? []) {
    const entry = resolveEntry(p);
    if (!entry) unmapped.push(p);
    else {
      planRowCount.set(
        entry.w2wPositionId,
        (planRowCount.get(entry.w2wPositionId) ?? 0) + p.rowCount,
      );
    }
  }

  // Aliases are never offered as a destination: pointing a mapping at one is
  // the silent failure this page exists to catch.
  const positionOptions: MapPositionOption[] = positionRows
    .filter((p) => p.mergedIntoId === null)
    .map((p) => ({ id: p.id, name: p.name, active: p.active }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectable = new Set(positionOptions.map((p) => p.id));

  const rows: W2wMapRow[] = map
    .map((m) => ({
      ...m,
      musterPositionName: nameById.get(m.musterPositionId) ?? null,
      // False when the row already points somewhere it may not: a deleted
      // position or an alias. The editor still has to show that value, or the
      // one row the admin most needs to fix would have nothing selected and a
      // dead Save button.
      targetSelectable: selectable.has(m.musterPositionId),
      planRowCount: planPositions === null ? null : (planRowCount.get(m.w2wPositionId) ?? 0),
    }))
    .sort(
      (a, b) =>
        a.w2wPositionName.localeCompare(b.w2wPositionName) ||
        a.w2wPositionId.localeCompare(b.w2wPositionId),
    );

  return {
    rows,
    positionOptions,
    issues: mapHealthIssues({ map, targets, planPositions }),
    unmapped,
    plan,
  };
}

/** Just the problems, for the hub's alert list and nav count. */
export async function getW2wMapIssues(): Promise<MapIssue[]> {
  const { map, targets, planPositions } = await loadMapHealthInputs();
  return mapHealthIssues({ map, targets, planPositions });
}

export interface W2wNameCoverage {
  /** On-roster students with a W2W name on file. */
  matched: number;
  /** On-roster students with none: they export under a guessed name. */
  missing: { email: string; displayName: string }[];
}

/**
 * How much of the roster the W2W name list covers. The export already warns
 * about a guessed name, but only for students the current run happened to
 * place; this answers the question before a run exists.
 */
export async function getW2wNameCoverage(): Promise<W2wNameCoverage> {
  const db = getDb();
  const [rosterRows, employeeRows] = await Promise.all([
    // On-roster only, which also drops the test accounts (they are never on it).
    db
      .select({ email: students.email, displayName: students.displayName })
      .from(students)
      .where(eq(students.onRoster, true)),
    db.select({ email: w2wEmployees.email }).from(w2wEmployees),
  ]);
  const known = new Set(employeeRows.map((e) => e.email));
  const missing = rosterRows
    .filter((s) => !known.has(s.email))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { matched: rosterRows.length - missing.length, missing };
}
