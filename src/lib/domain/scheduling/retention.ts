/**
 * Which schedule_runs are stale enough to prune, given a retention count.
 *
 * Runs are ranked newest first by `rankedAt` (the caller's
 * coalesce(restoredAt, generatedAt), so a restored run reads as fresh), tied
 * by id descending. A pinned run is excluded from the ranking pool entirely
 * rather than merely protected once ranked: pinning removes a run from
 * competition for a retention slot, so it can never displace an unpinned
 * run's spot. The current run is never stale regardless of its rank, since
 * it is the live schedule.
 */
export interface RunRetentionInfo {
  id: string;
  status: "current" | "superseded";
  pinned: boolean;
  rankedAt: Date;
}

export function staleRunIds(runs: readonly RunRetentionInfo[], retention: number): string[] {
  const rankable = runs
    .filter((r) => !r.pinned)
    .sort((a, b) => b.rankedAt.getTime() - a.rankedAt.getTime() || (a.id > b.id ? -1 : 1));
  return rankable
    .slice(retention)
    .filter((r) => r.status !== "current")
    .map((r) => r.id);
}
