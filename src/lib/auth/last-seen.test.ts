import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/lib/db";
import { recordSeen } from "./last-seen";

/** Logs each UPDATE's table and the stamp it set. */
function fakeDb(fail = false) {
  const updates: { table: string; lastSeenAt: Date }[] = [];
  const db = {
    update: (table: Table) => ({
      set: (values: { lastSeenAt: Date }) => ({
        where: async () => {
          if (fail) throw new Error("db down");
          updates.push({ table: getTableName(table), lastSeenAt: values.lastSeenAt });
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

beforeEach(() => vi.clearAllMocks());

describe("recordSeen", () => {
  it("stamps the person and their place in the current term with one time", async () => {
    const updates = fakeDb();
    await recordSeen(someone());
    expect(updates.map((u) => u.table)).toEqual(["students", "term_members"]);
    expect(updates[0]!.lastSeenAt).toBe(updates[1]!.lastSeenAt);
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
});
