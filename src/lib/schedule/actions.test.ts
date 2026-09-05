import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module: the admin gate, the DB handle, the
// settings row and the Drive sheet relay are all I/O. Stub them so the clear
// action, which is pure write plumbing, can be exercised in node against a
// recorded write log. `./data` is left real, so the report a cleared run stores
// can be read back through the same loader the run history uses.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  getSchedulingParams: vi.fn(),
  setSetting: vi.fn(),
  SETTING_SCHEDULE_PARAMS: "schedule_params",
}));
vi.mock("@/lib/admin/sheet-sync", () => ({
  SCHEDULE_SHEET: "schedule",
  SHEET_MANUAL_COOLDOWN_MS: 0,
  syncSheet: vi.fn(),
  trySyncSheet: vi.fn(),
}));

import { getTableName, type Table } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { clearScheduleRun } from "./actions";
import { listScheduleRuns } from "./data";

const nameOf = (table: unknown) => getTableName(table as Table);

interface Write {
  op: "insert" | "update" | "delete";
  table: string;
  values?: Record<string, unknown>;
}

interface QueryChain {
  from(table: unknown): QueryChain;
  innerJoin(...args: unknown[]): QueryChain;
  where(...args: unknown[]): QueryChain;
  orderBy(...args: unknown[]): QueryChain;
  groupBy(...args: unknown[]): QueryChain;
  limit(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: reads answer from `rows` keyed by the table
 * they select FROM, writes are logged in order, and every write resolves to the
 * `[{ affectedRows }]` shape the action destructures.
 */
function fakeDb(rows: Record<string, unknown[]> = {}, affectedRows = 0) {
  const writes: Write[] = [];
  const select = (): QueryChain => {
    let table = "";
    const chain: QueryChain = {
      from(t) {
        table = nameOf(t);
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      then: (fulfil, reject) => Promise.resolve(rows[table] ?? []).then(fulfil, reject),
    };
    return chain;
  };
  const done = (write: Write) => {
    const chain = {
      where: () => chain,
      then: (fulfil?: (r: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve([{ affectedRows }]).then(fulfil, reject),
    };
    writes.push(write);
    return chain;
  };
  const handle = {
    select: () => select(),
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) =>
        done({ op: "insert" as const, table: nameOf(t), values: Array.isArray(v) ? v[0] : v }),
    }),
    update: (t: unknown) => ({
      set: (v: Record<string, unknown>) =>
        done({ op: "update" as const, table: nameOf(t), values: v }),
    }),
    delete: (t: unknown) => done({ op: "delete" as const, table: nameOf(t) }),
    transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(handle),
  };
  return { handle, writes };
}

const writesTo = (writes: Write[], table: string, op: Write["op"]) =>
  writes.filter((w) => w.table === table && w.op === op);

describe("clearScheduleRun", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "boss@wisc.edu" });
    vi.mocked(revalidatePath).mockClear();
  });

  it("refuses a non-admin and writes nothing", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    const { handle, writes } = fakeDb();
    vi.mocked(getDb).mockReturnValue(handle as never);

    expect(await clearScheduleRun(true)).toEqual({ ok: false, error: "Admins only." });
    expect(writes).toEqual([]);
  });

  it("supersedes the old run and appends an empty one as current", async () => {
    const { handle, writes } = fakeDb();
    vi.mocked(getDb).mockReturnValue(handle as never);

    expect(await clearScheduleRun(false)).toMatchObject({ ok: true });

    // The flip comes first, then the new row: no window with two current runs.
    const [flip] = writesTo(writes, "schedule_runs", "update");
    expect(flip?.values).toEqual({ status: "superseded" });
    const [inserted] = writesTo(writes, "schedule_runs", "insert");
    expect(inserted?.values).toMatchObject({ status: "current", generatedBy: "boss@wisc.edu" });
    expect(writes.indexOf(flip!)).toBeLessThan(writes.indexOf(inserted!));
    // Nothing is deleted, and the new run holds no assignments.
    expect(writesTo(writes, "schedule_assignments", "insert")).toEqual([]);
    expect(writes.filter((w) => w.op === "delete")).toEqual([]);
  });

  it("stamps the run as a snapshot over the whole roster", async () => {
    const { handle, writes } = fakeDb();
    vi.mocked(getDb).mockReturnValue(handle as never);
    await clearScheduleRun(false);

    // Not "generated": the scope ledger counts a generated run as a re-solve of
    // the slice it names, and a cleared run solved nothing.
    const [inserted] = writesTo(writes, "schedule_runs", "insert");
    expect(inserted?.values).toMatchObject({ kind: "snapshot", scopeJson: null });
  });

  it("stores a report the run history can read back", async () => {
    const { handle, writes } = fakeDb();
    vi.mocked(getDb).mockReturnValue(handle as never);
    await clearScheduleRun(false);
    const [inserted] = writesTo(writes, "schedule_runs", "insert");

    // The stored JSON goes back through listScheduleRuns, which parses it
    // unguarded: a report missing a field it reads takes the whole table down.
    const runRow = {
      ...inserted!.values,
      generatedAt: new Date("2026-09-05T12:00:00Z"),
      pinned: false,
      restoredAt: null,
      restoredBy: null,
    };
    const reader = fakeDb({ schedule_runs: [runRow] });
    vi.mocked(getDb).mockReturnValue(reader.handle as never);

    const [listed] = await listScheduleRuns();
    expect(listed).toMatchObject({
      assignments: 0,
      students: 0,
      shortOfTarget: 0,
      belowMinHours: null,
      origin: "cleared",
    });
    // No health snapshot: the panel falls back rather than reporting zeros.
    expect(JSON.parse(String(inserted!.values!.summaryJson)).stats).toBeUndefined();
  });

  it("clears the scheduled marks only when asked", async () => {
    const withFlag = fakeDb({}, 4);
    vi.mocked(getDb).mockReturnValue(withFlag.handle as never);
    const res = await clearScheduleRun(true);
    expect(res).toEqual({ ok: true, unmarked: 4 });
    expect(writesTo(withFlag.writes, "submissions", "update")[0]?.values).toEqual({
      scheduled: false,
    });
    expect(vi.mocked(revalidatePath).mock.calls.flat()).toContain("/admin/responses");

    vi.mocked(revalidatePath).mockClear();
    const without = fakeDb({}, 4);
    vi.mocked(getDb).mockReturnValue(without.handle as never);
    expect(await clearScheduleRun(false)).toEqual({ ok: true, unmarked: 0 });
    expect(writesTo(without.writes, "submissions", "update")).toEqual([]);
    expect(vi.mocked(revalidatePath).mock.calls.flat()).not.toContain("/admin/responses");
  });
});
