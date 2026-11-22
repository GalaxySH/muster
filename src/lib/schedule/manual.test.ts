import { beforeEach, describe, expect, it, vi } from "vitest";

// manual.ts is a server-action module: the admin gate, the DB handle, and the
// Drive sheet relay are all I/O. Stub them so clearStudentSchedule, which is
// pure write plumbing, can be exercised in node against a recorded write log.
// `./data` is left real, so `loadCurrentRunRow` reads back through the same
// fake rows.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
// A generator module may not import the console (lib/admin), so the mock's
// own replacement is captured through vi.hoisted rather than a real import of
// "@/lib/admin/sheet-sync" in this file.
const trySyncSheet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/sheet-sync", () => ({
  SCHEDULE_SHEET: "schedule",
  SHEET_MANUAL_COOLDOWN_MS: 0,
  syncSheet: vi.fn(),
  trySyncSheet,
}));

import { getTableName, type Table } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { applyScheduleEdits, clearStudentSchedule } from "./manual";

const nameOf = (table: unknown) => getTableName(table as Table);

interface Write {
  op: "delete" | "transaction";
  table: string;
}

interface QueryChain {
  from(table: unknown): QueryChain;
  leftJoin(...args: unknown[]): QueryChain;
  where(...args: unknown[]): QueryChain;
  orderBy(...args: unknown[]): QueryChain;
  limit(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: a `schedule_runs` select answers from
 * `runs`, a `students` select from `rosterRows` (the on-roster lookup), and
 * every delete is logged and resolves to `[{ affectedRows }]`, the shape
 * `clearStudentSchedule` destructures. A transaction is logged and never run.
 */
function fakeDb(runs: unknown[] = [], affectedRows = 0, rosterRows: unknown[] = []) {
  const writes: Write[] = [];
  const select = (): QueryChain => {
    let table = "";
    const chain: QueryChain = {
      from(t) {
        table = nameOf(t);
        return chain;
      },
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (fulfil, reject) =>
        Promise.resolve(
          table === "schedule_runs" ? runs : table === "students" ? rosterRows : [],
        ).then(fulfil, reject),
    };
    return chain;
  };
  const handle = {
    select: () => select(),
    transaction: () => {
      writes.push({ op: "transaction", table: "" });
      return Promise.resolve([]);
    },
    delete: (t: unknown) => {
      writes.push({ op: "delete", table: nameOf(t) });
      const chain = {
        where: () => chain,
        then: (fulfil?: (r: unknown) => unknown, reject?: (r: unknown) => unknown) =>
          Promise.resolve([{ affectedRows }]).then(fulfil, reject),
      };
      return chain;
    },
  };
  return { handle, writes };
}

describe("clearStudentSchedule", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "boss@wisc.edu" });
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(trySyncSheet).mockClear();
  });

  it("refuses a non-admin and writes nothing", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    const { handle, writes } = fakeDb();
    vi.mocked(getDb).mockReturnValue(handle as never);

    expect(await clearStudentSchedule("s@wisc.edu")).toEqual({ ok: false, error: "Admins only." });
    expect(writes).toEqual([]);
  });

  it("refuses when no schedule has been generated", async () => {
    const { handle, writes } = fakeDb([]);
    vi.mocked(getDb).mockReturnValue(handle as never);

    const res = await clearStudentSchedule("s@wisc.edu");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/generate a schedule/i);
    expect(writes).toEqual([]);
  });

  it("deletes every row the current run holds for that student", async () => {
    const { handle, writes } = fakeDb([{ id: "run-1", status: "current" }], 3);
    vi.mocked(getDb).mockReturnValue(handle as never);

    const res = await clearStudentSchedule("s@wisc.edu");

    expect(res).toEqual({ ok: true, removed: 3 });
    expect(writes).toEqual([{ op: "delete", table: "schedule_assignments" }]);
    expect(vi.mocked(revalidatePath).mock.calls.flat()).toContain("/admin/students/s%40wisc.edu");
    expect(vi.mocked(revalidatePath).mock.calls.flat()).toContain("/admin/schedule");
    expect(trySyncSheet).toHaveBeenCalledWith("schedule");
  });

  it("is a no-op, with no refresh, when the student already has no rows there", async () => {
    const { handle, writes } = fakeDb([{ id: "run-1", status: "current" }], 0);
    vi.mocked(getDb).mockReturnValue(handle as never);

    const res = await clearStudentSchedule("s@wisc.edu");

    expect(res).toEqual({ ok: true, removed: 0 });
    expect(writes).toHaveLength(1); // the delete still runs; it just matches nothing
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(trySyncSheet).not.toHaveBeenCalled();
  });

  it("normalizes the email it revalidates", async () => {
    const { handle } = fakeDb([{ id: "run-1", status: "current" }], 1);
    vi.mocked(getDb).mockReturnValue(handle as never);

    await clearStudentSchedule("  S@WISC.EDU  ");

    expect(vi.mocked(revalidatePath).mock.calls.flat()).toContain("/admin/students/s%40wisc.edu");
  });
});

describe("applyScheduleEdits roster check", () => {
  const cell = { blockId: "b1", day: "mon" } as never;

  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "boss@wisc.edu" });
  });

  it("refuses to add a shift for a student who left the roster, and writes nothing", async () => {
    const { handle, writes } = fakeDb([{ id: "run-1", status: "current" }], 0, []);
    vi.mocked(getDb).mockReturnValue(handle as never);

    const res = await applyScheduleEdits("gone@wisc.edu", [], [cell]);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no longer on the roster/i);
    expect(writes).toEqual([]);
  });

  it("lets an on-roster student through to the run check", async () => {
    const { handle } = fakeDb([], 0, [{ email: "s@wisc.edu" }]);
    vi.mocked(getDb).mockReturnValue(handle as never);

    const res = await applyScheduleEdits("s@wisc.edu", [], [cell]);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/generate a schedule/i);
  });

  it("lets an admin place a test account, which is off the roster by design", async () => {
    const { handle, writes } = fakeDb([{ id: "run-1", status: "current" }], 0, []);
    vi.mocked(getDb).mockReturnValue(handle as never);

    const res = await applyScheduleEdits("trainee@test.muster.invalid", [], [cell]);

    expect(res.ok).toBe(true);
    expect(writes).toEqual([{ op: "transaction", table: "" }]);
  });

  it("still lets an admin remove a departed student's rows", async () => {
    const { handle } = fakeDb([], 0, []);
    vi.mocked(getDb).mockReturnValue(handle as never);

    const res = await applyScheduleEdits("gone@wisc.edu", [cell], []);

    expect(res.error).not.toMatch(/roster/i);
    expect(res.error).toMatch(/generate a schedule/i);
  });
});
