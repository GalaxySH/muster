/**
 * Health checks for the W2W position map (docs/w2w-shift-plan-roundtrip.md §4).
 *
 * The map is the only link between a W2W position and a Muster one, and every
 * way it can be wrong is quiet: matching resolves a row, filling zips students
 * onto seats by (block, day) alone, and the export ships. Nothing downstream
 * re-checks that the students landing on a W2W shift hold the position that
 * shift belongs to. So the checks have to live here, up front, and say plainly
 * what the admin will see in the exported file.
 *
 * Pure: the admin page, the hub alert, and the tests all run these same rules.
 */
import { buildMapResolver } from "./match";
import type { W2wPositionMapEntry } from "./types";

/** What the position config knows about a mapping's target. */
export interface MapTarget {
  id: string;
  name: string;
  active: boolean;
  /** Set when this position is an alias of another; students live on that one. */
  mergedIntoId: string | null;
  mergedIntoName: string | null;
  /** Blocks that are neither deleted nor retired: what a row can match. */
  liveBlockCount: number;
  /** Of those, the weekend ones. A weekday-only position cannot take Sat/Sun rows. */
  liveWeekendBlockCount: number;
}

/** One W2W position the current plan contains. */
export interface PlanPosition {
  w2wPositionId: string;
  w2wPositionName: string;
  rowCount: number;
  /** Of those, the rows falling on a Saturday or Sunday. */
  weekendRowCount: number;
}

export type MapIssueKind =
  | "empty_map"
  | "unmapped_position"
  | "target_missing"
  | "target_alias"
  | "target_inactive"
  | "target_no_blocks"
  | "target_no_weekend_blocks"
  | "duplicate_fill_order"
  | "unused_mapping";

export interface MapIssue {
  kind: MapIssueKind;
  /** danger: shifts export with no names. warning: worth a look, not broken. */
  severity: "danger" | "warning";
  /** The W2W position this is about, when it is about a single one. */
  w2wPositionId: string | null;
  message: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "its 5 shifts a week" against a plan, "its shifts" without one. Returned as
 * a whole phrase so a missing count cannot leave a gap in the sentence.
 */
const shiftsPhrase = (rowCount: number | undefined) =>
  rowCount === undefined ? "its shifts" : `its ${plural(rowCount, "shift")} a week`;

export interface MapHealthInput {
  map: readonly W2wPositionMapEntry[];
  targets: readonly MapTarget[];
  /**
   * The W2W positions in the current plan, or null when none is imported.
   * Plan-relative checks are skipped while it is null, because with no plan
   * there is nothing to be right or wrong about.
   */
  planPositions: readonly PlanPosition[] | null;
}

/**
 * Every problem with the current map, worst first. Each message says what
 * happens in the export rather than naming the internal cause, because that
 * is the thing the admin can check against W2W.
 */
export function mapHealthIssues({ map, targets, planPositions }: MapHealthInput): MapIssue[] {
  const issues: MapIssue[] = [];
  const targetById = new Map(targets.map((t) => [t.id, t]));

  // Resolve the plan through the same resolver matching uses (id, then name),
  // and credit each plan position's rows to the entry that actually answered
  // for it. Keying this by id alone would call an entry "unused" whenever W2W
  // recreated its position under a new id, which is exactly the case the name
  // fallback exists to survive.
  const resolveEntry = buildMapResolver(map);
  const rowsByEntry = new Map<string, number>();
  const weekendRowsByEntry = new Map<string, number>();
  const unmapped: PlanPosition[] = [];
  for (const p of planPositions ?? []) {
    const entry = resolveEntry(p);
    if (!entry) {
      unmapped.push(p);
      continue;
    }
    const key = entry.w2wPositionId;
    rowsByEntry.set(key, (rowsByEntry.get(key) ?? 0) + p.rowCount);
    weekendRowsByEntry.set(key, (weekendRowsByEntry.get(key) ?? 0) + p.weekendRowCount);
  }

  // Only worth saying when there is a plan whose shifts it would cost.
  if (map.length === 0 && planPositions !== null) {
    issues.push({
      kind: "empty_map",
      severity: "danger",
      w2wPositionId: null,
      message:
        "No W2W positions are mapped to Muster positions, so every shift in the plan exports with no names.",
    });
  }

  for (const p of unmapped) {
    issues.push({
      kind: "unmapped_position",
      severity: "danger",
      w2wPositionId: p.w2wPositionId,
      message: `${p.w2wPositionName} is not mapped to a Muster position, so ${shiftsPhrase(p.rowCount)} export with no names.`,
    });
  }

  for (const entry of map) {
    const target = targetById.get(entry.musterPositionId);
    const rows = rowsByEntry.get(entry.w2wPositionId);

    if (!target) {
      issues.push({
        kind: "target_missing",
        severity: "danger",
        w2wPositionId: entry.w2wPositionId,
        message: `${entry.w2wPositionName} points at a Muster position that no longer exists, so ${shiftsPhrase(rows)} export with no names.`,
      });
      continue;
    }

    // An alias keeps its blocks, so plan rows still match them and the plan
    // report still counts them as matched, but the students moved to the
    // position it points at and nobody is ever assigned here.
    if (target.mergedIntoId !== null) {
      const to = target.mergedIntoName ?? target.mergedIntoId;
      issues.push({
        kind: "target_alias",
        severity: "danger",
        w2wPositionId: entry.w2wPositionId,
        message: `${entry.w2wPositionName} points at ${target.name}, which is now an alias of ${to}. Point it at ${to} instead, or ${shiftsPhrase(rows)} export with no names.`,
      });
    } else if (!target.active) {
      issues.push({
        kind: "target_inactive",
        severity: "danger",
        w2wPositionId: entry.w2wPositionId,
        message: `${entry.w2wPositionName} points at ${target.name}, which is turned off. Nobody is scheduled into it, so ${shiftsPhrase(rows)} export with no names.`,
      });
    }

    if (target.liveBlockCount === 0) {
      issues.push({
        kind: "target_no_blocks",
        severity: "danger",
        w2wPositionId: entry.w2wPositionId,
        message: `${entry.w2wPositionName} points at ${target.name}, which has no shifts set up, so ${shiftsPhrase(rows)} export with no names.`,
      });
    } else if (
      (weekendRowsByEntry.get(entry.w2wPositionId) ?? 0) > 0 &&
      target.liveWeekendBlockCount === 0
    ) {
      const weekend = weekendRowsByEntry.get(entry.w2wPositionId)!;
      issues.push({
        kind: "target_no_weekend_blocks",
        severity: "danger",
        w2wPositionId: entry.w2wPositionId,
        message: `${entry.w2wPositionName} has ${plural(weekend, "weekend shift")} a week, but ${target.name} has no weekend shifts, so those export with no names.`,
      });
    }

    if (planPositions !== null && rows === undefined) {
      issues.push({
        kind: "unused_mapping",
        severity: "warning",
        w2wPositionId: entry.w2wPositionId,
        message: `${entry.w2wPositionName} is mapped but the current plan has no shifts on it. Remove it if W2W no longer uses this position.`,
      });
    }
  }

  // Two W2W positions sharing one Muster block cell fill in fill-order, then
  // source order. Equal fill orders leave the tie to the order W2W happened to
  // export the rows in, so which student lands on which physical shift can
  // move between imports with nothing changing on Muster's side.
  const byTarget = new Map<string, W2wPositionMapEntry[]>();
  for (const entry of map) {
    const list = byTarget.get(entry.musterPositionId);
    if (list) list.push(entry);
    else byTarget.set(entry.musterPositionId, [entry]);
  }
  for (const [positionId, entries] of byTarget) {
    if (entries.length < 2) continue;
    const orders = new Set(entries.map((e) => e.fillOrder));
    if (orders.size === entries.length) continue;
    const name = targetById.get(positionId)?.name ?? positionId;
    issues.push({
      kind: "duplicate_fill_order",
      severity: "warning",
      w2wPositionId: null,
      message: `${entries.map((e) => e.w2wPositionName).join(" and ")} share ${name} and the same fill order. Give them different fill orders so each one always gets the same shifts.`,
    });
  }

  const rank = (i: MapIssue) => (i.severity === "danger" ? 0 : 1);
  return issues.sort((a, b) => rank(a) - rank(b));
}
