import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { getCurrentTermId } from "./term-id";

/** A handle whose one select answers with `rows` and records the tables it read. */
function fakeDb(rows: unknown[]) {
  const reads: string[] = [];
  const chain = {
    from(t: unknown) {
      reads.push(getTableName(t as Table));
      return chain;
    },
    innerJoin(t: unknown) {
      reads.push(getTableName(t as Table));
      return chain;
    },
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { db: { select: () => chain } as never, reads };
}

describe("getCurrentTermId", () => {
  // Read through the terms table, so the id returned is a term that exists.
  it("returns the term the pointer names", async () => {
    const { db, reads } = fakeDb([{ id: "2026-fall" }]);
    await expect(getCurrentTermId(db)).resolves.toBe("2026-fall");
    expect(reads).toEqual(["app_settings", "terms"]);
  });

  // Failing closed: no pointer, or a pointer at a term that is gone, joins to
  // nothing. It must never read as some other term or as "every term".
  it("throws when the pointer is missing or names no term", async () => {
    await expect(getCurrentTermId(fakeDb([]).db)).rejects.toThrow(/No current term/);
  });

  it("throws on a blank id", async () => {
    await expect(getCurrentTermId(fakeDb([{ id: "" }]).db)).rejects.toThrow(/No current term/);
  });
});

describe("the schema has no default term", () => {
  const TERM_SCOPED = [
    "submissions",
    "close_slots",
    "schedule_runs",
    "shift_plans",
    "change_requests",
    "groups",
    "term_members",
    "positions",
    "shift_blocks",
    "roster_title_mappings",
    "w2w_position_map",
    "roster_imports",
  ];
  const tables = (Object.values(schema) as unknown[]).filter((v): v is Table => is(v, Table));
  const termIdOf = (table: Table) =>
    Object.values(getTableColumns(table)).find((c) => c.name === "term_id");

  // A declared default would let an insert compile without saying which term
  // it belongs to, and the row would land wherever the default points.
  it("requires the term on every insert into a term-scoped table", () => {
    const scoped = tables.filter((t) => termIdOf(t));
    expect(scoped.map((t) => getTableName(t)).sort()).toEqual([...TERM_SCOPED].sort());
    for (const table of scoped) {
      const column = termIdOf(table)!;
      expect([getTableName(table), column.notNull, column.hasDefault]).toEqual([
        getTableName(table),
        true,
        false,
      ]);
    }
  });
});
