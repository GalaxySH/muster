import { describe, expect, it } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { closeRequirementOf, ensureCloseRequirements } from "./requirements";

const nameOf = (table: unknown) => getTableName(table as Table);

/** Answers every read with `rows` and records what gets inserted. */
function fakeDb(rows: unknown[]) {
  const inserted: { table: string; values: unknown }[] = [];
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (fulfil: (r: unknown[]) => unknown) => Promise.resolve(rows).then(fulfil),
  };
  const db = {
    select: () => chain,
    insert: (t: unknown) => ({
      values: (values: unknown) => ({
        onDuplicateKeyUpdate: async () => {
          inserted.push({ table: nameOf(t), values });
        },
      }),
    }),
  };
  return { db: db as never, inserted };
}

describe("ensureCloseRequirements", () => {
  it("gives each lead without a number the term's default", async () => {
    const { db, inserted } = fakeDb([
      { email: "a@wisc.edu", required: 2 },
      { email: "b@wisc.edu", required: 2 },
    ]);
    expect(await ensureCloseRequirements(db, "2027-spring")).toBe(2);
    expect(inserted).toEqual([
      {
        table: "close_requirements",
        values: [
          { termId: "2027-spring", studentEmail: "a@wisc.edu", required: 2 },
          { termId: "2027-spring", studentEmail: "b@wisc.edu", required: 2 },
        ],
      },
    ]);
  });

  it("writes nothing when every lead already has one", async () => {
    const { db, inserted } = fakeDb([]);
    expect(await ensureCloseRequirements(db, "2027-spring")).toBe(0);
    expect(inserted).toEqual([]);
  });
});

describe("closeRequirementOf", () => {
  it("reads the lead's own number", async () => {
    const { db } = fakeDb([{ own: 1, termDefault: 3 }]);
    expect(await closeRequirementOf(db, "t", "a@wisc.edu")).toEqual({ required: 1, assigned: true });
  });

  // Zero is a real number, not a missing one.
  it("keeps an own number of zero", async () => {
    const { db } = fakeDb([{ own: 0, termDefault: 3 }]);
    expect(await closeRequirementOf(db, "t", "a@wisc.edu")).toEqual({ required: 0, assigned: true });
  });

  it("falls back to the term's default, marked as not yet theirs", async () => {
    const { db } = fakeDb([{ own: null, termDefault: 3 }]);
    expect(await closeRequirementOf(db, "t", "a@wisc.edu")).toEqual({ required: 3, assigned: false });
  });

  it("refuses a term that does not exist", async () => {
    const { db } = fakeDb([]);
    await expect(closeRequirementOf(db, "nope", "a@wisc.edu")).rejects.toThrow(/No term/);
  });
});
