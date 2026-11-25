import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/terms/term-id", () => ({ getCurrentTermId: vi.fn() }));

import { getDb } from "@/lib/db";
import { getCurrentTermId } from "@/lib/terms/term-id";
import { recordSeen } from "./last-seen";

const dialect = new MySqlDialect();

/** Logs each UPDATE's table, the stamp it set, and its WHERE as rendered SQL. */
function fakeDb(fail = false) {
  const updates: { table: string; lastSeenAt: Date; where: { sql: string; params: unknown[] } }[] =
    [];
  const db = {
    update: (table: Table) => ({
      set: (values: { lastSeenAt: Date }) => ({
        where: async (condition: SQL) => {
          if (fail) throw new Error("db down");
          updates.push({
            table: getTableName(table),
            lastSeenAt: values.lastSeenAt,
            where: dialect.sqlToQuery(condition),
          });
        },
      }),
    }),
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return updates;
}

// The throttle is per email and lives for the process, so each test uses its own.
let n = 0;
const someone = () => `seen-${++n}@wisc.edu`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentTermId).mockResolvedValue("2027-spring");
});

describe("recordSeen", () => {
  it("stamps the person and their place in the current term with one time", async () => {
    const updates = fakeDb();
    await recordSeen(someone());
    expect(updates.map((u) => u.table)).toEqual(["students", "term_members"]);
    expect(updates[0]!.lastSeenAt).toBe(updates[1]!.lastSeenAt);
  });

  it("stamps only that person's row in the term it read, named by value", async () => {
    const updates = fakeDb();
    const email = someone();
    await recordSeen(email);
    expect(updates[0]!.where.params).toEqual([email]);
    const member = updates[1]!.where;
    expect(member.sql).toBe(
      "(`term_members`.`student_email` = ? and `term_members`.`term_id` = ?)",
    );
    expect(member.params).toEqual([email, "2027-spring"]);
    expect(member.sql).not.toMatch(/select/i);
  });

  it("writes once for many requests close together", async () => {
    const updates = fakeDb();
    const email = someone();
    await Promise.all([recordSeen(email), recordSeen(email), recordSeen(email)]);
    await recordSeen(email);
    expect(updates).toHaveLength(2);
  });

  it("never throws, and lets the next request try again after a failure", async () => {
    const email = someone();
    fakeDb(true);
    await expect(recordSeen(email)).resolves.toBeUndefined();
    const updates = fakeDb();
    await recordSeen(email);
    expect(updates).toHaveLength(2);
  });

  it("never throws when the current term cannot be read, and tries again next time", async () => {
    const email = someone();
    const updates = fakeDb();
    vi.mocked(getCurrentTermId).mockRejectedValueOnce(new Error("No current term"));
    await expect(recordSeen(email)).resolves.toBeUndefined();
    expect(updates.map((u) => u.table)).toEqual(["students"]);

    await recordSeen(email);
    expect(updates.map((u) => u.table)).toEqual(["students", "students", "term_members"]);
    expect(updates[2]!.where.params).toEqual([email, "2027-spring"]);
  });
});
