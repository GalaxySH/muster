import { describe, expect, it } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  assignMembers,
  inGroup,
  inNoGroup,
  inTestGroup,
  membershipOf,
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
  it("joins a student to their row in one term", () => {
    const q = render(membershipOf("2026-fall"));
    expect(q.sql).toBe(
      "(`group_members`.`student_email` = `students`.`email` and `group_members`.`term_id` = ?)",
    );
    expect(q.params).toEqual(["2026-fall"]);
  });

  // Found by the group's kind, never its id: each term has its own test group.
  it("finds test accounts by the group's kind, inside the term", () => {
    const q = render(inTestGroup("2026-fall"));
    expect(q.sql).toContain("`group_members`.`term_id` = ?");
    expect(q.sql).toContain("`groups`.`kind` = 'test'");
    expect(q.params).toEqual(["2026-fall"]);
  });

  it("treats a row with no group the same as no row", () => {
    const q = render(inNoGroup("2026-fall"));
    expect(q.sql).toMatch(/^not exists/);
    expect(q.sql).toContain("`group_members`.`group_id` is not null");
  });

  it("matches members of one group", () => {
    expect(render(inGroup("g1")).params).toEqual(["g1"]);
  });
});

describe("assignMembers", () => {
  it("writes the membership row and keeps the retired student columns in step", async () => {
    const { db, writes } = fakeDb();
    await assignMembers(db, "2026-fall", ["a@wisc.edu", "b@wisc.edu"], "g1", false);
    expect(writes).toEqual([
      {
        op: "upsert",
        table: "group_members",
        values: [
          { termId: "2026-fall", studentEmail: "a@wisc.edu", groupId: "g1", assignedAuto: false },
          { termId: "2026-fall", studentEmail: "b@wisc.edu", groupId: "g1", assignedAuto: false },
        ],
        set: { groupId: "g1", assignedAuto: false },
      },
      { op: "update", table: "students", set: { groupId: "g1", groupAssignedAuto: false } },
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
      { op: "update", table: "group_members", set: { groupId: null } },
      { op: "update", table: "students", set: { groupId: null } },
    ]);
  });
});
