import { beforeEach, describe, expect, it, vi } from "vitest";

// The panel's reads name an employee by email, and the same person is in every
// term, so they take the term the page was rendered for. The real gate runs
// here against a stubbed session; vitest.setup.ts answers "test-term" as the
// working term.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/drive/relay", () => ({ relayDelete: vi.fn() }));
vi.mock("@/lib/roster/lookup", () => ({ findStudentByEmail: vi.fn() }));
vi.mock("@/lib/availability/data", () => ({ loadPositionWithBlocks: vi.fn() }));
vi.mock("./data", () => ({ listChangeRequests: vi.fn() }));

import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getDb } from "@/lib/db";
import { getAppSession } from "@/lib/auth/session";
import { STALE_TERM_MESSAGE } from "@/lib/auth/require-admin";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadPositionWithBlocks } from "@/lib/availability/data";
import { currentTermId } from "@/lib/terms/working";
import { listChangeRequests } from "./data";
import {
  adminListChangeRequests,
  adminShiftTimeBlocks,
  deleteChangeRequest,
  setChangeRequestResolved,
  updateChangeRequest,
} from "./admin-actions";

const EMAIL = "worker@wisc.edu";

interface StoredRequest {
  id: string;
  termId: string;
  studentEmail: string;
}

const COLUMNS: Record<string, keyof StoredRequest> = {
  id: "id",
  term_id: "termId",
  student_email: "studentEmail",
};

/**
 * Evaluate a WHERE made only of `change_requests` column equalities joined by
 * `and`. Anything else (an inequality, an `or`, another table) throws, so an
 * inverted predicate fails the test instead of matching by accident.
 */
function matches(where: { sql: string; params: unknown[] }, row: StoredRequest): boolean {
  const parts = where.sql.replace(/^\((.*)\)$/, "$1").split(" and ");
  if (parts.length !== where.params.length) throw new Error(`cannot evaluate: ${where.sql}`);
  return parts.every((part, i) => {
    const column = COLUMNS[/^`change_requests`\.`(\w+)` = \?$/.exec(part)?.[1] ?? ""];
    if (!column) throw new Error(`cannot evaluate: ${where.sql}`);
    return row[column] === where.params[i];
  });
}

/**
 * Stand-in for the drizzle handle. A change_requests read returns the stored
 * rows its WHERE matches, and the last one is kept for the test to inspect.
 * Every write is logged by table.
 */
function fakeDb(stored: StoredRequest[]) {
  const writes: string[] = [];
  const reads: { sql: string; params: unknown[] }[] = [];
  const select = () => {
    let table = "";
    let where = { sql: "", params: [] as unknown[] };
    const chain = {
      from(t: unknown) {
        table = getTableName(t as Table);
        return chain;
      },
      where(clause: unknown) {
        where = new MySqlDialect().sqlToQuery(clause as SQL);
        reads.push(where);
        return chain;
      },
      limit: () => chain,
      then(fulfil?: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve()
          .then(() =>
            table === "change_requests"
              ? stored
                  .filter((r) => matches(where, r))
                  .map((r) => ({ studentEmail: r.studentEmail }))
              : [],
          )
          .then(fulfil, reject);
      },
    };
    return chain;
  };
  const handle = {
    select,
    update(t: unknown) {
      writes.push(`update ${getTableName(t as Table)}`);
      return { set: () => ({ where: async () => undefined }) };
    },
    delete(t: unknown) {
      writes.push(`delete ${getTableName(t as Table)}`);
      return { where: async () => undefined };
    },
  };
  vi.mocked(getDb).mockReturnValue(handle as unknown as ReturnType<typeof getDb>);
  return { writes, reads };
}

const EDIT = { day: "tue", shiftText: "2p to 5p", comment: "Class moved", permanent: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppSession).mockResolvedValue({
    email: "admin@wisc.edu",
    isAdmin: true,
  } as Awaited<ReturnType<typeof getAppSession>>);
  vi.mocked(listChangeRequests).mockResolvedValue([]);
  vi.mocked(findStudentByEmail).mockResolvedValue({
    email: EMAIL,
    positionId: "cashier",
  } as Awaited<ReturnType<typeof findStudentByEmail>>);
  vi.mocked(loadPositionWithBlocks).mockResolvedValue({
    blocks: [{ dayType: "weekday", start: 600, end: 840 }],
  } as unknown as Awaited<ReturnType<typeof loadPositionWithBlocks>>);
  // An earlier semester is selected: the current one differs from the working "test-term".
  vi.mocked(currentTermId).mockResolvedValue("spring-2027");
});

// The panel's reads follow the same rule as filing a request: nobody picked
// (null) is the admin's own, in the current semester; anyone picked, the admin
// included, is read in the term the page was rendered for.
describe("adminListChangeRequests", () => {
  it("reads the admin's own requests from the current semester when nobody is picked", async () => {
    await adminListChangeRequests(null, "test-term");
    expect(listChangeRequests).toHaveBeenCalledWith("admin@wisc.edu", "spring-2027");
  });

  it("reads the admin's own requests even from a tab showing another term", async () => {
    await adminListChangeRequests(null, "other-term");
    expect(listChangeRequests).toHaveBeenCalledWith("admin@wisc.edu", "spring-2027");
  });

  it("reads the admin in the page's term when they pick themselves", async () => {
    await adminListChangeRequests("Admin@wisc.edu", "test-term");
    expect(listChangeRequests).toHaveBeenCalledWith("admin@wisc.edu", "test-term");
  });

  it("lists the employee's requests in the page's term", async () => {
    await adminListChangeRequests(EMAIL, "test-term");
    expect(listChangeRequests).toHaveBeenCalledWith(EMAIL, "test-term");
  });

  it.each([EMAIL, "admin@wisc.edu"])(
    "reads nothing for %s from a tab showing another term",
    async (who) => {
      expect(await adminListChangeRequests(who, "other-term")).toEqual([]);
      expect(listChangeRequests).not.toHaveBeenCalled();
    },
  );

  it("reads nothing for someone who is not an admin", async () => {
    vi.mocked(getAppSession).mockResolvedValue({
      email: EMAIL,
      isAdmin: false,
    } as Awaited<ReturnType<typeof getAppSession>>);
    expect(await adminListChangeRequests(null, "test-term")).toEqual([]);
    expect(await adminListChangeRequests(EMAIL, "test-term")).toEqual([]);
    expect(listChangeRequests).not.toHaveBeenCalled();
  });
});

describe("adminShiftTimeBlocks", () => {
  it("reads the employee's position in the page's term", async () => {
    expect(await adminShiftTimeBlocks(EMAIL, "test-term")).toEqual([
      { dayType: "weekday", start: 600, end: 840 },
    ]);
    expect(findStudentByEmail).toHaveBeenCalledWith(EMAIL, "test-term");
  });

  it("reads the admin's own position in the current semester when nobody is picked", async () => {
    await adminShiftTimeBlocks(null, "test-term");
    expect(findStudentByEmail).toHaveBeenCalledWith("admin@wisc.edu", "spring-2027");
  });

  it("reads the admin in the page's term when they pick themselves", async () => {
    await adminShiftTimeBlocks("admin@wisc.edu", "test-term");
    expect(findStudentByEmail).toHaveBeenCalledWith("admin@wisc.edu", "test-term");
  });

  it("reads nothing for a tab showing another term", async () => {
    expect(await adminShiftTimeBlocks(EMAIL, "other-term")).toEqual([]);
    expect(findStudentByEmail).not.toHaveBeenCalled();
  });
});

// The row actions take the term the page was rendered for. A tab showing
// another term is told so; otherwise the request is looked up inside the
// working term ("test-term"), and another term's request is gone.
describe("change-request row actions", () => {
  const actions = [
    [
      "setChangeRequestResolved",
      (id: string, termId: string) => setChangeRequestResolved(id, true, termId),
    ],
    ["updateChangeRequest", (id: string, termId: string) => updateChangeRequest(id, EDIT, termId)],
    ["deleteChangeRequest", (id: string, termId: string) => deleteChangeRequest(id, termId)],
  ] as const;

  it.each(actions)("%s acts on a request in the working term", async (_name, act) => {
    const { writes, reads } = fakeDb([{ id: "req-1", termId: "test-term", studentEmail: EMAIL }]);
    expect(await act("req-1", "test-term")).toEqual({ ok: true });
    expect(writes).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      sql: "(`change_requests`.`id` = ? and `change_requests`.`term_id` = ?)",
      params: ["req-1", "test-term"],
    });
  });

  it.each(actions)(
    "%s refuses a request in another term and writes nothing",
    async (_name, act) => {
      const { writes } = fakeDb([{ id: "req-1", termId: "other-term", studentEmail: EMAIL }]);
      expect(await act("req-1", "test-term")).toEqual({
        ok: false,
        error: "This request no longer exists.",
      });
      expect(writes).toEqual([]);
    },
  );

  it.each(actions)("%s says a request that is gone is gone", async (_name, act) => {
    const { writes } = fakeDb([]);
    expect(await act("req-1", "test-term")).toEqual({
      ok: false,
      error: "This request no longer exists.",
    });
    expect(writes).toEqual([]);
  });

  it.each(actions)(
    "%s tells a tab showing another term to reload, and reads and writes nothing",
    async (_name, act) => {
      const { writes, reads } = fakeDb([
        { id: "req-1", termId: "other-term", studentEmail: EMAIL },
      ]);
      expect(await act("req-1", "other-term")).toEqual({ ok: false, error: STALE_TERM_MESSAGE });
      expect(reads).toEqual([]);
      expect(writes).toEqual([]);
    },
  );
});
