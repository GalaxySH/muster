import { describe, expect, it } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  assignMembers,
  inGroup,
  inNoGroup,
  inTestGroup,
  unassignMembers,
} from "./membership";

const render = (clause: SQL | undefined) => new MySqlDialect().sqlToQuery(clause!);
const nameOf = (table: unknown) => getTableName(table as Table);

/** Records every write, in order, with the values it carried. */
function fakeDb() {
  const writes: { op: string; table: string; values?: unknown; set?: unknown }[] = [];
  const db = {
    insert: (t: unknown) => ({
      values: (values: unknown) => ({
        onDuplicateKeyUpdate: async ({ set }: { set: unknown }) => {
          writes.push({ op: "upsert", table: nameOf(t), values, set });
        },
      }),
    }),
    update: (t: unknown) => ({
      set: (set: unknown) => ({
        where: async () => {
          writes.push({ op: "update", table: nameOf(t), set });
        },
      }),
    }),
  };
  return { db: db as never, writes };
}

describe("membership predicates", () => {
  // Found by the group's kind, never its id: each term has its own test group.
  it("finds test accounts by the group's kind, inside the term", () => {
    const q = render(inTestGroup("2026-fall"));
    expect(q.sql).toContain("`term_members`.`term_id` = ?");
    expect(q.sql).toContain("`groups`.`kind` = 'test'");
    expect(q.params).toEqual(["2026-fall"]);
  });

  it("treats a row with no group the same as no row", () => {
    const q = render(inNoGroup("2026-fall"));
    expect(q.sql).toMatch(/^not exists/);
    expect(q.sql).toContain("`term_members`.`group_id` is not null");
  });

  it("matches members of one group", () => {
    expect(render(inGroup("g1")).params).toEqual(["g1"]);
  });
});

describe("assignMembers", () => {
  it("writes the membership row", async () => {
    const { db, writes } = fakeDb();
    await assignMembers(db, "2026-fall", ["a@wisc.edu", "b@wisc.edu"], "g1", false);
    expect(writes).toEqual([
      {
        op: "upsert",
        table: "term_members",
        values: [
          { termId: "2026-fall", studentEmail: "a@wisc.edu", groupId: "g1", assignedAuto: false },
          { termId: "2026-fall", studentEmail: "b@wisc.edu", groupId: "g1", assignedAuto: false },
        ],
        set: { groupId: "g1", assignedAuto: false },
      },
    ]);
  });

  it("marks a sweep's assignment as automatic", async () => {
    const { db, writes } = fakeDb();
    await assignMembers(db, "2026-fall", ["a@wisc.edu"], "g1", true);
    expect(writes[0]?.set).toEqual({ groupId: "g1", assignedAuto: true });
  });

  it("writes nothing for an empty list", async () => {
    const { db, writes } = fakeDb();
    await assignMembers(db, "2026-fall", [], "g1", false);
    expect(writes).toEqual([]);
  });
});

describe("unassignMembers", () => {
  // The row stays with a null group, so the sticky marker survives and the
  // sweep does not put a removed student straight back.
  it("clears the group and leaves the auto marker alone", async () => {
    const { db, writes } = fakeDb();
    await unassignMembers(db, "2026-fall", ["a@wisc.edu"]);
    expect(writes).toEqual([
      { op: "update", table: "term_members", set: { groupId: null } },
    ]);
  });
});
