import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module: the admin gate, the DB handle, cache
// revalidation, and the match inputs are all I/O. Stub them so each entry
// point's gate can be exercised in node, and so a refusal can be told apart
// from "the write was rolled back" by whether the DB was reached at all.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getTableName, type Table } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { importW2wEmployeesFromUpload, setPlanRotationWeek } from "./actions";

const nameOf = (table: unknown) => getTableName(table as Table);

interface QueryChain {
  from(table: unknown): QueryChain;
  where(...args: unknown[]): QueryChain;
  limit(...args: unknown[]): QueryChain;
  orderBy(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: enough of the builder chain to answer these
 * actions' reads, with rows keyed by the table each read selects FROM, plus a
 * log of every write attempted and the values it carried.
 */
function fakeDb(rows: Record<string, unknown[]>) {
  const log = {
    writes: [] as string[],
    inserted: [] as { table: string; values: unknown }[],
    updated: [] as { table: string; values: unknown }[],
  };

  const handle = () => {
    const select = (): QueryChain => {
      let table = "";
      const chain: QueryChain = {
        from(t) {
          table = nameOf(t);
          return chain;
        },
        where: () => chain,
        limit: () => chain,
        orderBy: () => chain,
        then: (fulfil, reject) => Promise.resolve(rows[table] ?? []).then(fulfil, reject),
      };
      return chain;
    };
    return {
      select,
      insert: (t: unknown) => ({
        values: async (values: unknown) => {
          log.writes.push(`insert:${nameOf(t)}`);
          log.inserted.push({ table: nameOf(t), values });
        },
      }),
      update: (t: unknown) => ({
        set: (values: unknown) => ({
          where: async () => {
            log.writes.push(`update:${nameOf(t)}`);
            log.updated.push({ table: nameOf(t), values });
          },
        }),
      }),
      delete: (t: unknown) => {
        const done = async () => {
          log.writes.push(`delete:${nameOf(t)}`);
        };
        return { where: done, then: (f?: () => void) => done().then(f) };
      },
    };
  };

  const tx = handle();
  const db = {
    ...handle(),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx),
  };
  return { db, log };
}

function useDb(rows: Record<string, unknown[]> = {}) {
  const { db, log } = fakeDb(rows);
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return log;
}

const EMPLOYEES_CSV = [
  '"Employee Name","Address","City","Phone","Email","Employee Number","Last Logon","Max Hours Wk"',
  '"Ada Lovelace","","","","ada@wisc.edu","123","",""',
].join("\n");

function upload(csv: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("file", new File([csv], "export.csv", { type: "text/csv" }));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "admin@wisc.edu" });
});

describe("setPlanRotationWeek", () => {
  const current = { shift_plans: [{ id: "plan-1" }] };

  it("refuses a signed-in non-admin without touching the database", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    expect(await setPlanRotationWeek("plan-1", "b")).toEqual({ ok: false, error: "Admins only." });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not signed in", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "You are not signed in." });
    expect(await setPlanRotationWeek("plan-1", "b")).toEqual({
      ok: false,
      error: "You are not signed in.",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("updates the rotation for an admin", async () => {
    const log = useDb(current);
    expect(await setPlanRotationWeek("plan-1", "b")).toEqual({ ok: true });
    expect(log.updated).toEqual([{ table: "shift_plans", values: { rotationWeek: "b" } }]);
  });
});

describe("importW2wEmployeesFromUpload", () => {
  it("refuses a signed-in non-admin without touching the database", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    expect(await importW2wEmployeesFromUpload(upload(EMPLOYEES_CSV))).toEqual({
      ok: false,
      error: "Admins only.",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not signed in", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "You are not signed in." });
    expect(await importW2wEmployeesFromUpload(upload(EMPLOYEES_CSV))).toEqual({
      ok: false,
      error: "You are not signed in.",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("replaces the employee mirror for an admin", async () => {
    const log = useDb();
    const result = await importW2wEmployeesFromUpload(upload(EMPLOYEES_CSV));
    expect(result).toEqual({
      ok: true,
      summary: { total: 1, added: 1, updated: 0, removed: 0, skipped: 0 },
    });
    expect(log.writes).toEqual(["delete:w2w_employees", "insert:w2w_employees"]);
  });
});
