import { describe, expect, it } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { releaseDepartedSchedules } from "./import";

// importRoster itself is DB-integration-shaped (reads a workbook, resolves
// title mappings, runs inside a transaction) and is exercised through the CLI
// and the admin upload, not a unit test. releaseDepartedSchedules is the one
// piece of new logic worth pinning in isolation: a departed student's
// schedule must stop looking "done" the moment they leave, so a later rehire
// doesn't inherit a stale, pre-departure run (the bug this fixes).
const nameOf = (table: unknown) => getTableName(table as Table);

function fakeTx(queues: Record<string, unknown[][]>) {
  const pending: Record<string, unknown[][]> = Object.fromEntries(
    Object.entries(queues).map(([k, v]) => [k, [...v]]),
  );
  const log = {
    writes: [] as string[],
    updated: [] as { table: string; set: unknown }[],
  };

  const next = (table: string): unknown[] => {
    const queue = pending[table];
    if (!queue || queue.length === 0) return [];
    return (queue.length === 1 ? queue[0] : queue.shift()) ?? [];
  };

  const select = () => {
    let table = "";
    const chain = {
      from(t: unknown) {
        table = nameOf(t);
        return chain;
      },
      where: () => chain,
      limit: () => chain,
      then: (fulfil?: (rows: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(next(table)).then(fulfil, reject),
    };
    return chain;
  };

  const tx = {
    select,
    update: (t: unknown) => {
      const table = nameOf(t);
      return {
        set: (set: unknown) => ({
          where: async () => {
            log.writes.push(`update:${table}`);
            log.updated.push({ table, set });
          },
        }),
      };
    },
    delete: (t: unknown) => {
      const table = nameOf(t);
      return {
        where: async () => {
          log.writes.push(`delete:${table}`);
        },
      };
    },
  };
  return { tx: tx as never, log };
}

describe("releaseDepartedSchedules", () => {
  it("does nothing when no one departed", async () => {
    const { tx, log } = fakeTx({});
    await releaseDepartedSchedules(tx, []);
    expect(log.writes).toEqual([]);
  });

  it("clears the scheduled mark and drops current-run rows when a current run exists", async () => {
    const { tx, log } = fakeTx({ schedule_runs: [[{ id: "run-1" }]] });
    await releaseDepartedSchedules(tx, ["a@wisc.edu", "b@wisc.edu"]);
    expect(log.writes).toEqual(["update:submissions", "delete:schedule_assignments"]);
    expect(log.updated[0]).toEqual({ table: "submissions", set: { scheduled: false } });
  });

  it("still clears the scheduled mark but deletes nothing when there is no current run", async () => {
    const { tx, log } = fakeTx({ schedule_runs: [[]] });
    await releaseDepartedSchedules(tx, ["a@wisc.edu"]);
    expect(log.writes).toEqual(["update:submissions"]);
  });
});
