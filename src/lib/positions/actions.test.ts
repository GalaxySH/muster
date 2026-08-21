import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module: its collaborators (the admin gate, the
// DB handle, cache revalidation, the flag seams) are all I/O. Stub them so the
// delete guards, which decide whether anything is written at all, can be
// exercised in node.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("./orphans", () => ({ syncOrphanFlagsForBlocks: vi.fn() }));
vi.mock("./apply-change", () => ({
  applyPositionChange: vi.fn(),
  resolveDeferredCarryOver: vi.fn(),
  syncRevalidationFlag: vi.fn(),
}));

import { getTableName, type Table } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { syncOrphanFlagsForBlocks } from "./orphans";
import { deleteBlock, deletePosition } from "./actions";

const nameOf = (table: unknown) => getTableName(table as Table);

interface QueryChain {
  from(table: unknown): QueryChain;
  innerJoin(...args: unknown[]): QueryChain;
  where(...args: unknown[]): QueryChain;
  limit(...args: unknown[]): QueryChain;
  for(mode: string): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: enough of the builder chain to answer the
 * reads these actions make, with rows keyed by the table each read selects
 * FROM (no read here selects from the same table twice). It records where each
 * read happened (outside the transaction or inside it), which reads took a
 * lock, and every write that was ATTEMPTED, so a test can tell "the guard
 * refused before writing" apart from "the write was rolled back".
 */
function fakeDb(rows: Record<string, unknown[]>) {
  const log = {
    outsideReads: [] as string[],
    txReads: [] as string[],
    locks: [] as string[],
    writes: [] as string[],
    rolledBack: false,
  };

  const handle = (inTx: boolean) => {
    const reads = inTx ? log.txReads : log.outsideReads;
    const select = (): QueryChain => {
      let table = "";
      const chain: QueryChain = {
        from(t) {
          table = nameOf(t);
          reads.push(table);
          return chain;
        },
        innerJoin: () => chain,
        where: () => chain,
        limit: () => chain,
        for(mode) {
          log.locks.push(`${table}:${mode}`);
          return chain;
        },
        then: (fulfil, reject) => Promise.resolve(rows[table] ?? []).then(fulfil, reject),
      };
      return chain;
    };
    const write = (verb: string) => (t: unknown) => {
      const table = nameOf(t);
      const done = async () => {
        log.writes.push(`${verb}:${table}`);
      };
      return { where: done, set: () => ({ where: done }) };
    };
    return { select, delete: write("delete"), update: write("update"), insert: write("insert") };
  };

  const tx = handle(true);
  const db = {
    ...handle(false),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      try {
        return await run(tx);
      } catch (e) {
        log.rolledBack = true;
        throw e;
      }
    },
  };
  return { db, log };
}

function useDb(rows: Record<string, unknown[]>) {
  const { db, log } = fakeDb(rows);
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return log;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "admin@wisc.edu" });
  vi.mocked(syncOrphanFlagsForBlocks).mockResolvedValue(0);
});

describe("deletePosition", () => {
  const clear = { positions: [{ id: "barista" }] };

  it("deletes the position and its config when nothing points at it", async () => {
    const log = useDb(clear);
    expect(await deletePosition("barista")).toEqual({ ok: true });
    expect(log.writes).toEqual([
      "delete:w2w_position_map",
      "delete:roster_title_mappings",
      "delete:shift_blocks",
      "delete:positions",
    ]);
  });

  it("refuses when a saved run holds shifts on the position's blocks", async () => {
    const log = useDb({ ...clear, schedule_assignments: [{ n: 2 }] });
    expect(await deletePosition("barista")).toEqual({
      ok: false,
      error:
        "A saved schedule run still has shifts on this position's blocks. Deactivate it instead.",
    });
    expect(log.writes).toEqual([]);
    expect(log.rolledBack).toBe(true);
  });

  it("refuses while students still hold the position", async () => {
    const log = useDb({ ...clear, students: [{ n: 3 }] });
    expect(await deletePosition("barista")).toEqual({
      ok: false,
      error: "3 students still hold this position. Deactivate it instead.",
    });
    expect(log.writes).toEqual([]);
  });

  it("refuses while picks sit on the position's blocks", async () => {
    const log = useDb({ ...clear, internal_selections: [{ n: 1 }] });
    expect(await deletePosition("barista")).toEqual({
      ok: false,
      error: "Students still have shift picks on this position's blocks. Deactivate it instead.",
    });
    expect(log.writes).toEqual([]);
  });

  it("refuses a position that is gone", async () => {
    const log = useDb({ positions: [] });
    expect(await deletePosition("barista")).toEqual({ ok: false, error: "Position not found." });
    expect(log.writes).toEqual([]);
  });

  it("never touches the DB for Shift Lead or for a non-admin", async () => {
    useDb(clear);
    expect(await deletePosition(SHIFT_LEAD_POSITION_ID)).toEqual({
      ok: false,
      error: "Shift Lead is built in and can't be deleted.",
    });
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    expect(await deletePosition("barista")).toEqual({ ok: false, error: "Admins only." });
    expect(getDb).not.toHaveBeenCalled();
  });

  // The guard counts have to be atomic with the delete: read outside the
  // transaction they only describe a moment that has passed, and a schedule
  // generation committing in between reopens the silent cascade.
  it("reads every guard inside the transaction, behind a lock", async () => {
    const log = useDb({ ...clear, schedule_assignments: [{ n: 1 }] });
    await deletePosition("barista");
    expect(log.outsideReads).toEqual([]);
    expect(log.txReads).toEqual([
      "positions",
      "shift_blocks",
      "students",
      "shift_selections",
      "internal_selections",
      "schedule_assignments",
    ]);
    expect(log.locks).toEqual(["positions:update", "shift_blocks:update"]);
  });
});

describe("deleteBlock", () => {
  const live = { shift_blocks: [{ id: "b1", retiredAt: null }] };

  it("deletes outright when nothing points at the block", async () => {
    const log = useDb(live);
    expect(await deleteBlock("b1")).toEqual({ ok: true, retired: false, orphaned: 0 });
    expect(log.writes).toEqual(["delete:shift_blocks"]);
  });

  it("retires instead of deleting when a saved run holds the block", async () => {
    vi.mocked(syncOrphanFlagsForBlocks).mockResolvedValue(2);
    const log = useDb({ ...live, schedule_assignments: [{ n: 1 }] });
    expect(await deleteBlock("b1")).toEqual({ ok: true, retired: true, orphaned: 2 });
    expect(log.writes).toEqual(["update:shift_blocks"]);
  });

  it("retires when students hold picks on the block", async () => {
    const log = useDb({ ...live, shift_selections: [{ n: 4 }] });
    expect(await deleteBlock("b1")).toEqual({ ok: true, retired: true, orphaned: 0 });
    expect(log.writes).toEqual(["update:shift_blocks"]);
  });

  it("refuses a block that is gone, or already removed, without writing", async () => {
    const missing = useDb({ shift_blocks: [] });
    expect(await deleteBlock("b1")).toEqual({
      ok: false,
      error: "Block not found.",
      retired: false,
      orphaned: 0,
    });
    expect(missing.writes).toEqual([]);

    const retired = useDb({ shift_blocks: [{ id: "b1", retiredAt: new Date() }] });
    expect(await deleteBlock("b1")).toEqual({
      ok: false,
      error: "This shift is already removed.",
      retired: false,
      orphaned: 0,
    });
    expect(retired.writes).toEqual([]);
    expect(retired.rolledBack).toBe(true);
  });

  it("reads the block and its references inside the transaction, behind a lock", async () => {
    const log = useDb(live);
    await deleteBlock("b1");
    expect(log.outsideReads).toEqual([]);
    expect(log.txReads).toEqual([
      "shift_blocks",
      "shift_selections",
      "internal_selections",
      "schedule_assignments",
    ]);
    expect(log.locks).toEqual(["shift_blocks:update"]);
  });
});
