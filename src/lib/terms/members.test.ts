import { describe, expect, it } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { enrollMember, setMemberPosition, takeOffRoster } from "./members";

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

describe("enrollMember", () => {
  it("writes the person's place in the term and mirrors it to the retired columns", async () => {
    const { db, writes } = fakeDb();
    const place = { positionId: "cashier", onRoster: true, rosterTitle: "Cashier" };
    await enrollMember(db, "2026-fall", "a@wisc.edu", place);
    expect(writes).toEqual([
      {
        op: "upsert",
        table: "term_members",
        values: { termId: "2026-fall", studentEmail: "a@wisc.edu", ...place },
        // The group on the same row is not in the update: an import must not move it.
        set: place,
      },
      {
        op: "update",
        table: "students",
        set: { legacyPositionId: "cashier", legacyOnRoster: true, legacyRosterTitle: "Cashier" },
      },
    ]);
  });
});

describe("setMemberPosition", () => {
  it("moves the term's rows and the retired column together", async () => {
    const { db, writes } = fakeDb();
    await setMemberPosition(db, "2026-fall", ["a@wisc.edu", "b@wisc.edu"], "stocker");
    expect(writes).toEqual([
      { op: "update", table: "term_members", set: { positionId: "stocker" } },
      { op: "update", table: "students", set: { legacyPositionId: "stocker" } },
    ]);
  });

  it("does nothing for nobody", async () => {
    const { db, writes } = fakeDb();
    await setMemberPosition(db, "2026-fall", [], "stocker");
    expect(writes).toEqual([]);
  });
});

describe("takeOffRoster", () => {
  // A flag, never a delete: the position and the group stay on the row.
  it("only clears the roster flag", async () => {
    const { db, writes } = fakeDb();
    await takeOffRoster(db, "2026-fall", ["a@wisc.edu"]);
    expect(writes).toEqual([
      { op: "update", table: "term_members", set: { onRoster: false } },
      { op: "update", table: "students", set: { legacyOnRoster: false } },
    ]);
  });

  it("does nothing for nobody", async () => {
    const { db, writes } = fakeDb();
    await takeOffRoster(db, "2026-fall", []);
    expect(writes).toEqual([]);
  });
});
