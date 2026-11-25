import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module whose collaborators are all I/O (the
// admin gate, the DB handle, the Drive relay, auth). Stub them so the delete
// guards, which decide whether anything is removed at all, can be exercised in
// node. `fail()` redirects, so the stubbed redirect throws and the tests read
// the refusal off the thrown URL.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ MAGIC_LINK_PROVIDER: "magic-link" }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/magic-link-store", () => ({ issueMagicLink: vi.fn() }));
vi.mock("@/lib/positions/data", () => ({ positionOptions: vi.fn() }));
vi.mock("@/lib/drive/relay", () => ({ relayDelete: vi.fn() }));
vi.mock("@/lib/evidence/data", () => ({ collectSubmissionDriveFileIds: vi.fn() }));
vi.mock("@/lib/changes/data", () => ({ collectChangeRequestDriveFileIds: vi.fn() }));

import { getTableName, type Table } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { collectChangeRequestDriveFileIds } from "@/lib/changes/data";
import { collectSubmissionDriveFileIds } from "@/lib/evidence/data";
import { relayDelete } from "@/lib/drive/relay";
const TEST_GROUP_ID = "dev-test";
import { deleteTestAccount } from "./actions";

const nameOf = (table: unknown) => getTableName(table as Table);

interface QueryChain {
  from(table: unknown): QueryChain;
  innerJoin(...args: unknown[]): QueryChain;
  where(...args: unknown[]): QueryChain;
  limit(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: enough of the builder chain to answer this
 * action's reads, keyed by the table each one selects FROM, and a log of every
 * delete it attempted, in order.
 */
function fakeDb(rows: Record<string, unknown[]>) {
  const deletes: string[] = [];
  const select = (): QueryChain => {
    let table = "";
    const chain: QueryChain = {
      from(t) {
        table = nameOf(t);
        return chain;
      },
      // The joined table does not change the keying: rows are still keyed by the
      // table the query selects FROM.
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (fulfil, reject) => Promise.resolve(rows[table] ?? []).then(fulfil, reject),
    };
    return chain;
  };
  const db = {
    select,
    delete: (t: unknown) => ({
      where: async () => {
        deletes.push(nameOf(t));
      },
    }),
  };
  return { db, deletes };
}

function useDb(rows: Record<string, unknown[]>) {
  const { db, deletes } = fakeDb(rows);
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { deletes };
}

const form = (email: string) => {
  const data = new FormData();
  data.set("email", email);
  return data;
};

const EMAIL = "training-barista@test.muster.invalid";
/** A real student address, as a test-group member could have. */
const REAL_EMAIL = "real.student@wisc.edu";
// Membership is read through term_members joined to its group; the group's
// kind is what marks the test-accounts group.
const testAccount = { term_members: [{ group: { id: TEST_GROUP_ID, kind: "test" } }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "admin@wisc.edu" });
  vi.mocked(collectSubmissionDriveFileIds).mockResolvedValue([]);
  vi.mocked(collectChangeRequestDriveFileIds).mockResolvedValue([]);
});

describe("deleteTestAccount", () => {
  it("deletes an account with nothing in a saved run", async () => {
    const { deletes } = useDb({ ...testAccount, submissions: [{ id: "s1" }] });
    await deleteTestAccount(form(EMAIL));
    expect(deletes).toEqual(["submissions", "magic_links", "students"]);
  });

  // Synthetic-domain accounts are placed on purpose and their rows never reach
  // the schedule, so the shifts cascade away with the account.
  it("deletes a test account that holds shifts, taking the shifts with it", async () => {
    const { deletes } = useDb({
      ...testAccount,
      submissions: [{ id: "s1" }],
      schedule_assignments: [{ runId: "r1" }],
    });
    await deleteTestAccount(form(EMAIL));
    expect(deletes).toEqual(["submissions", "magic_links", "students"]);
  });

  // The delete removes the person in every term, so a real student who was put
  // in the test group from the Groups page must never reach it.
  it("refuses a test-group member at a real address and deletes nothing", async () => {
    const { deletes } = useDb({
      ...testAccount,
      submissions: [{ id: "s1" }],
      schedule_assignments: [{ runId: "r1" }],
    });
    await expect(deleteTestAccount(form(REAL_EMAIL))).rejects.toThrow(
      "REDIRECT /admin/test-users?error=not-found",
    );
    expect(deletes).toEqual([]);
    expect(relayDelete).not.toHaveBeenCalled();
  });

  it("still refuses a synthetic address outside the test group", async () => {
    const { deletes } = useDb({ term_members: [{ group: { id: "gordon", kind: null } }] });
    await expect(deleteTestAccount(form(EMAIL))).rejects.toThrow(
      "REDIRECT /admin/test-users?error=not-found",
    );
    expect(deletes).toEqual([]);
  });

  it("refuses a non-admin before reading anything", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    useDb(testAccount);
    await expect(deleteTestAccount(form(EMAIL))).rejects.toThrow(
      "REDIRECT /admin/test-users?error=forbidden",
    );
    expect(getDb).not.toHaveBeenCalled();
  });
});
