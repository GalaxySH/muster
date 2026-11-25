import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module: its collaborators (the admin gate, the
// DB handle, cache revalidation, the flag seams) are all I/O. Stub them so the
// delete guards, which decide whether anything is written at all, can be
// exercised in node.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The real admin gate runs, so the semester check is exercised too.
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("./orphans", () => ({ syncOrphanFlagsForBlocks: vi.fn() }));
vi.mock("./apply-change", () => ({
  applyPositionChange: vi.fn(),
  resolveDeferredCarryOver: vi.fn(),
  syncRevalidationFlag: vi.fn(),
}));

import { and, eq, getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getAppSession } from "@/lib/auth/session";
import { STALE_TERM_MESSAGE } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { positions, w2wPositionMap } from "@/lib/db/schema";
import { workingTermId } from "@/lib/terms/working";
import { applyPositionChange, type PositionChangeResult } from "./apply-change";
import { syncOrphanFlagsForBlocks } from "./orphans";
import {
  createPosition,
  createPositionForTitle,
  deleteBlock,
  deletePosition,
  mapTitleToPosition,
  setAlias,
} from "./actions";

const nameOf = (table: unknown) => getTableName(table as Table);

/** A WHERE as the SQL text and params MySQL would get, so two can be compared. */
const render = (where: unknown) => new MySqlDialect().sqlToQuery(where as SQL);

const signIn = (isAdmin: boolean) =>
  vi
    .mocked(getAppSession)
    .mockResolvedValue({ email: "admin@wisc.edu", name: null, isAdmin, method: "google" });

interface WriteCall {
  write: string;
  set?: unknown;
  values?: unknown;
  where?: unknown;
}

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
 * refused before writing" apart from "the write was rolled back". Each write's
 * arguments and each read's WHERE are kept too, for the tests that check them.
 */
function fakeDb(rows: Record<string, unknown[]>) {
  const log = {
    outsideReads: [] as string[],
    txReads: [] as string[],
    locks: [] as string[],
    writes: [] as string[],
    calls: [] as WriteCall[],
    readWheres: [] as { table: string; where: unknown }[],
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
        where: (where) => {
          log.readWheres.push({ table, where });
          return chain;
        },
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
      const call: WriteCall = { write: `${verb}:${nameOf(t)}` };
      const done = async (where?: unknown) => {
        call.where = where;
        log.writes.push(call.write);
        log.calls.push(call);
      };
      return {
        where: done,
        set: (set: unknown) => {
          call.set = set;
          return { where: done };
        },
        values: (values: unknown) => {
          call.values = values;
          const written = done();
          return Object.assign(written, { onDuplicateKeyUpdate: () => written });
        },
      };
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
  signIn(true);
  // vitest.setup.ts answers "test-term"; put that back after a test changes it.
  vi.mocked(workingTermId).mockImplementation(async () => "test-term");
  vi.mocked(syncOrphanFlagsForBlocks).mockResolvedValue(0);
  const unchanged: PositionChangeResult = {
    hadSubmission: false,
    carriedOver: 0,
    preserved: 0,
    removedShifts: 0,
    releasedCloses: [],
    deferred: false,
    revalidationFailed: false,
  };
  vi.mocked(applyPositionChange).mockResolvedValue(unchanged);
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
    const log = useDb({ ...clear, term_members: [{ n: 3 }] });
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

  // Built in by its flag, not its id or name, so a renamed or copied Shift Lead
  // position is still protected.
  it("refuses the position whose holders pick closes", async () => {
    const log = useDb({
      positions: [{ id: "lead-copy", name: "Shift Lead", picksCloses: true }],
    });
    expect(await deletePosition("lead-copy")).toEqual({
      ok: false,
      error: "Shift Lead is built in and can't be deleted.",
    });
    expect(log.writes).toEqual([]);
  });

  it("never touches the DB for a non-admin", async () => {
    useDb(clear);
    signIn(false);
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
      "term_members",
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("createPosition", () => {
  it("refuses a page that was showing another semester, without touching the DB", async () => {
    useDb({});
    expect(await createPosition("2026-fall", "Line Cook")).toEqual({
      ok: false,
      error: STALE_TERM_MESSAGE,
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  // A later semester's positions have random ids while the first keeps the
  // fixture's, so a name that matches one of those ids is still free here.
  it("accepts a name equal to another semester's fixture id", async () => {
    const log = useDb({ positions: [] });
    expect(await createPosition("test-term", "barista")).toEqual({ ok: true });
    expect(log.readWheres).toHaveLength(1);
    expect(render(log.readWheres[0]?.where)).toEqual(
      render(and(eq(positions.name, "barista"), eq(positions.termId, "test-term"))),
    );
    expect(log.calls).toHaveLength(1);
    const [insert] = log.calls;
    expect(insert?.write).toBe("insert:positions");
    expect(insert?.values).toMatchObject({ termId: "test-term", name: "barista" });
    expect((insert?.values as { id: string }).id).toMatch(UUID);
  });

  it("refuses a name another position in the semester has", async () => {
    const log = useDb({ positions: [{ id: "x" }] });
    expect(await createPosition("test-term", "Barista")).toEqual({
      ok: false,
      error: "A position with that name already exists.",
    });
    expect(log.writes).toEqual([]);
  });

  it("refuses a name with no letter or number, without touching the DB", async () => {
    useDb({ positions: [] });
    expect(await createPosition("test-term", " -- !! ")).toEqual({
      ok: false,
      error: "The name needs at least one letter or number.",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("accepts a name whose only letters are outside A to Z", async () => {
    useDb({ positions: [] });
    expect(await createPosition("test-term", "Café")).toEqual({ ok: true });
  });
});

describe("createPositionForTitle", () => {
  it("refuses a page that was showing another semester, without touching the DB", async () => {
    useDb({});
    expect(await createPositionForTitle("2026-fall", "Line Cook")).toEqual({
      ok: false,
      error: STALE_TERM_MESSAGE,
      assigned: 0,
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("creates the position under a random id in the page's semester", async () => {
    const log = useDb({ positions: [] });
    expect(await createPositionForTitle("test-term", "Line Cook")).toEqual({
      ok: true,
      assigned: 0,
    });
    expect(render(log.readWheres[0]?.where)).toEqual(
      render(and(eq(positions.name, "Line Cook"), eq(positions.termId, "test-term"))),
    );
    const insert = log.calls.find((c) => c.write === "insert:positions");
    expect(insert?.values).toMatchObject({ termId: "test-term", name: "Line Cook" });
    expect((insert?.values as { id: string }).id).toMatch(UUID);
  });

  it("refuses a title with no letter or number, without touching the DB", async () => {
    useDb({ positions: [] });
    expect(await createPositionForTitle("test-term", "***")).toEqual({
      ok: false,
      error: "The title needs at least one letter or number.",
      assigned: 0,
    });
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("setAlias", () => {
  // Every semester holds the same W2W ids, so moving a mapping by its W2W id
  // alone would rewrite the other semesters' rows too.
  it("re-points only the source position's W2W mappings", async () => {
    const log = useDb({
      positions: [
        { id: "old", name: "Old", mergedIntoId: null, picksCloses: false },
        { id: "new", name: "New", mergedIntoId: null, picksCloses: false },
      ],
      term_members: [{ email: "a@wisc.edu" }],
      w2w_position_map: [{ id: "wp1", fillOrder: 0 }],
    });
    expect(await setAlias("old", "new")).toMatchObject({ ok: true, moved: 1, remapped: 1 });
    const update = log.calls.find((c) => c.write === "update:w2w_position_map");
    expect(update?.set).toEqual({ musterPositionId: "new", fillOrder: 1 });
    expect(render(update?.where)).toEqual(
      render(
        and(eq(w2wPositionMap.w2wPositionId, "wp1"), eq(w2wPositionMap.musterPositionId, "old")),
      ),
    );
  });
});

describe("mapTitleToPosition", () => {
  // Outside a render the term is not cached, so each lookup is a fresh query
  // that could answer differently. One action works in one term.
  it("looks the term up once and uses it for every read and write", async () => {
    let calls = 0;
    vi.mocked(workingTermId).mockImplementation(async () => (calls++ === 0 ? "A" : "B"));
    const log = useDb({
      positions: [{ id: "ca", name: "CA", active: true, mergedIntoId: null }],
      term_members: [
        { email: "a@wisc.edu", positionId: null, rosterTitle: "Line Cook" },
        { email: "b@wisc.edu", positionId: null, rosterTitle: "line cook" },
      ],
    });
    expect(await mapTitleToPosition("Line Cook", "ca")).toEqual({ ok: true, assigned: 2 });

    expect(workingTermId).toHaveBeenCalledTimes(1);
    const terms = vi.mocked(applyPositionChange).mock.calls.map(([, input]) => input.termId);
    expect(terms).toEqual(["A", "A"]);
    const mapping = log.calls.find((c) => c.write === "insert:roster_title_mappings");
    expect(mapping?.values).toMatchObject({ termId: "A" });
    const moved = log.calls.find((c) => c.write === "update:term_members");
    expect(render(moved?.where).params).toContain("A");
    for (const { where } of log.readWheres) expect(render(where).params).not.toContain("B");
  });
});
