import { describe, expect, it } from "vitest";

import { staleRunIds, type RunRetentionInfo } from "./retention";

const run = (
  id: string,
  daysAgo: number,
  opts: { status?: "current" | "superseded"; pinned?: boolean } = {},
): RunRetentionInfo => ({
  id,
  status: opts.status ?? "superseded",
  pinned: opts.pinned ?? false,
  rankedAt: new Date(2026, 0, 30 - daysAgo),
});

describe("staleRunIds", () => {
  it("prunes the oldest runs beyond the retention count", () => {
    const runs = [run("a", 0), run("b", 1), run("c", 2)];
    expect(staleRunIds(runs, 2)).toEqual(["c"]);
  });

  it("keeps everything when there are fewer runs than the retention count", () => {
    const runs = [run("a", 0), run("b", 1)];
    expect(staleRunIds(runs, 10)).toEqual([]);
  });

  it("never prunes the current run regardless of its rank", () => {
    const runs = [run("a", 0), run("b", 1), run("c", 2, { status: "current" })];
    expect(staleRunIds(runs, 1)).toEqual(["b"]);
  });

  it("excludes a pinned run from staleness even when it is the oldest", () => {
    const runs = [run("a", 0), run("b", 1), run("c", 2, { pinned: true })];
    expect(staleRunIds(runs, 2)).toEqual([]);
  });

  it("does not let a pinned run consume a retention slot", () => {
    // 11 unpinned runs plus one pinned run, retention of 10: without the
    // pin exclusion the pinned run would occupy rank 1 and push the 11th
    // unpinned run out of the window instead of the 12th.
    const unpinned = Array.from({ length: 11 }, (_, i) => run(`u${i}`, i + 1));
    const runs = [run("pinned", 0, { pinned: true }), ...unpinned];
    const stale = staleRunIds(runs, 10);
    expect(stale).toEqual(["u10"]);
    expect(stale).not.toContain("pinned");
  });

  it("breaks ties on equal rankedAt by id, descending", () => {
    const same = new Date(2026, 0, 1);
    const runs: RunRetentionInfo[] = [
      { id: "a", status: "superseded", pinned: false, rankedAt: same },
      { id: "b", status: "superseded", pinned: false, rankedAt: same },
      { id: "c", status: "superseded", pinned: false, rankedAt: same },
    ];
    // Rank order is c, b, a (id descending); retention of 2 keeps c and b.
    expect(staleRunIds(runs, 2)).toEqual(["a"]);
  });

  it("prunes everything unpinned and non-current when retention is 0", () => {
    const runs = [run("a", 0), run("b", 1, { status: "current" }), run("c", 2, { pinned: true })];
    expect(staleRunIds(runs, 0)).toEqual(["a"]);
  });
});
