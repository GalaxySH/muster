import { beforeEach, describe, expect, it, vi } from "vitest";

// startNewTerm takes a database handle, so the handle is the only thing faked.
// The fake answers each select with the rows staged for that table and ignores
// the filter, so what is staged is always the closing term's own rows. What is
// checked is what the function writes from them.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/closes/requirements", () => ({
  ensureCloseRequirements: vi.fn(async () => 2),
}));

import { getTableName, type Table } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ensureCloseRequirements } from "@/lib/closes/requirements";
import { StartTermError, startNewTerm } from "./start-term";

type Row = Record<string, unknown>;

const FALL = "2026-fall";
const TEST_EMAIL = "sam@test.muster.invalid";

const term = (over: Row = {}): Row => ({
  id: FALL,
  name: "Fall 2026",
  rosterConfig: '{"excludedTitles":["Supervisor"]}',
  closeRequirement: 3,
  ...over,
});

const position = (id: string, over: Row = {}): Row => ({
  id,
  termId: FALL,
  name: id,
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
  picksCloses: false,
  active: true,
  returnDate: "2026-09-08",
  mergedIntoId: null,
  ...over,
});

const block = (id: string, positionId: string): Row => ({
  id,
  termId: FALL,
  positionId,
  dayType: "weekday",
  startMinutes: 600,
  endMinutes: 840,
  desiredCapacity: 2,
});

const member = (email: string, over: Row = {}): Row => ({
  email,
  positionId: "cashier",
  onRoster: true,
  rosterTitle: "Cashier",
  groupKind: null,
  ...over,
});

/** The closing term: two positions, one more merged into Cashier. */
function stage(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    pointer: [{ value: FALL }],
    terms: [term()],
    positions: [
      position("cashier"),
      position("lead", { picksCloses: true, minHours: 15 }),
      position("market", { mergedIntoId: "cashier" }),
    ],
    shift_blocks: [block("b1", "cashier"), block("b2", "lead"), block("b3", "market")],
    roster_title_mappings: [
      { termId: FALL, title: "cashier", positionId: "cashier" },
      { termId: FALL, title: "market cashier", positionId: "market" },
      { termId: FALL, title: "ghost", positionId: "gone" },
    ],
    w2w_position_map: [
      {
        termId: FALL,
        w2wPositionId: "w1",
        w2wPositionName: "Market",
        musterPositionId: "market",
        fillOrder: 1,
      },
    ],
    app_settings: [{ value: '{"coveragePoolPositionIds":["lead","market","gone"],"seed":7}' }],
    term_members: [
      member("on@wisc.edu"),
      member("merged@wisc.edu", { positionId: "market" }),
      member("left@wisc.edu", { onRoster: false }),
      member(TEST_EMAIL, { onRoster: false, groupKind: "test" }),
      member("real-in-test@wisc.edu", { groupKind: "test" }),
      member("real-off-in-test@wisc.edu", { onRoster: false, groupKind: "test" }),
    ],
    ...over,
  };
}

function fakeDb(rows: Record<string, Row[]>) {
  const inserted = new Map<string, Row[]>();
  const pointerWrites: unknown[] = [];
  const tx = {
    select: () => ({
      from: (table: Table) => {
        const name = getTableName(table);
        let locked = false;
        const chain = {
          where: () => chain,
          leftJoin: () => chain,
          for: () => ((locked = true), chain),
          // The pointer is the one settings row read under a lock.
          then: (resolve: (r: Row[]) => void) =>
            resolve(locked ? rows.pointer! : (rows[name] ?? [])),
        };
        return chain;
      },
    }),
    insert: (table: Table) => ({
      values: async (values: Row | Row[]) => {
        const name = getTableName(table);
        inserted.set(name, [...(inserted.get(name) ?? []), ...[values].flat()]);
      },
    }),
    update: () => ({
      set: (values: Row) => ({
        where: async () => void pointerWrites.push(values.value),
      }),
    }),
  };
  const db = { transaction: (run: (t: typeof tx) => unknown) => run(tx) };
  return { db: db as unknown as Database, inserted, pointerWrites };
}

const input = {
  name: "Spring 2027",
  startsOn: "2027-01-19",
  endsOn: "2027-05-08",
  createdBy: "boss@wisc.edu",
  fromTermId: FALL,
};

beforeEach(() => vi.clearAllMocks());

describe("startNewTerm refusals", () => {
  const refused = async (rows: Record<string, Row[]>, name = input.name) => {
    const { db, inserted, pointerWrites } = fakeDb(rows);
    await expect(startNewTerm(db, { ...input, name })).rejects.toBeInstanceOf(StartTermError);
    expect(inserted.size).toBe(0);
    expect(pointerWrites).toEqual([]);
  };

  it("refuses when another term became current since the page loaded", () =>
    refused(stage({ pointer: [{ value: "spring-2027" }] })));

  it("refuses when the pointer row is missing", () => refused(stage({ pointer: [] })));

  it("refuses when the closing term cannot be found", () =>
    refused(stage({ terms: [term({ id: "other", name: "Other" })] })));

  it("refuses a name another semester has, whatever the case", () => refused(stage(), "fall 2026"));
});

describe("startNewTerm", () => {
  it("creates the term from the closing one and makes it current", async () => {
    const { db, inserted, pointerWrites } = fakeDb(stage());
    const summary = await startNewTerm(db, input);

    expect(summary.termId).toBe("spring-2027");
    expect(inserted.get("terms")).toEqual([
      expect.objectContaining({
        id: "spring-2027",
        name: "Spring 2027",
        startsOn: "2027-01-19",
        endsOn: "2027-05-08",
        rosterConfig: '{"excludedTitles":["Supervisor"]}',
        closeRequirement: 3,
        lateTravelAccept: false,
        travelAfterClose: false,
        createdBy: "boss@wisc.edu",
      }),
    ]);
    expect(pointerWrites).toEqual(["spring-2027"]);
    expect(ensureCloseRequirements).toHaveBeenCalledWith(expect.anything(), "spring-2027");
  });

  it("picks an id no term has yet", async () => {
    const rows = stage({ terms: [term(), term({ id: "spring-2027", name: "Old spring" })] });
    const { db } = fakeDb(rows);
    expect((await startNewTerm(db, input)).termId).toBe("spring-2027-2");
  });

  it("copies positions under new ids, without aliases or return dates", async () => {
    const { db, inserted } = fakeDb(stage());
    await startNewTerm(db, input);

    const copied = inserted.get("positions")!;
    expect(copied.map((p) => p.name)).toEqual(["cashier", "lead"]);
    for (const p of copied) {
      expect(p.termId).toBe("spring-2027");
      expect(p.returnDate).toBeNull();
      expect(["cashier", "lead", "market"]).not.toContain(p.id);
    }
    expect(new Set(copied.map((p) => p.id)).size).toBe(2);
    expect(copied[1]).toMatchObject({ picksCloses: true, minHours: 15 });
  });

  it("copies the blocks of copied positions only, under new ids", async () => {
    const { db, inserted } = fakeDb(stage());
    await startNewTerm(db, input);

    const ids = Object.fromEntries(inserted.get("positions")!.map((p) => [p.name, p.id]));
    const blocks = inserted.get("shift_blocks")!;
    expect(blocks.map((b) => b.positionId)).toEqual([ids.cashier, ids.lead]);
    for (const b of blocks) {
      expect(b.termId).toBe("spring-2027");
      expect(["b1", "b2", "b3"]).not.toContain(b.id);
      expect(b).toMatchObject({ dayType: "weekday", startMinutes: 600, endMinutes: 840 });
    }
  });

  it("points what named an alias at the position it was merged into", async () => {
    const { db, inserted } = fakeDb(stage());
    await startNewTerm(db, input);

    const ids = Object.fromEntries(inserted.get("positions")!.map((p) => [p.name, p.id]));
    // A mapping to a position that no longer exists is dropped.
    expect(inserted.get("roster_title_mappings")).toEqual([
      { termId: "spring-2027", title: "cashier", positionId: ids.cashier },
      { termId: "spring-2027", title: "market cashier", positionId: ids.cashier },
    ]);
    expect(inserted.get("w2w_position_map")).toEqual([
      {
        termId: "spring-2027",
        w2wPositionId: "w1",
        w2wPositionName: "Market",
        musterPositionId: ids.cashier,
        fillOrder: 1,
      },
    ]);
    const [params] = inserted.get("app_settings")!;
    expect(params!.key).toBe("schedule_params:spring-2027");
    expect(JSON.parse(params!.value as string)).toEqual({
      coveragePoolPositionIds: [ids.lead, ids.cashier],
      seed: 7,
    });
  });

  it("survives a merge loop in the old positions", async () => {
    const rows = stage({
      positions: [
        position("cashier"),
        position("a", { mergedIntoId: "b" }),
        position("b", { mergedIntoId: "a" }),
      ],
      roster_title_mappings: [{ termId: FALL, title: "loop", positionId: "a" }],
    });
    const { db, inserted } = fakeDb(rows);
    await startNewTerm(db, input);
    expect(inserted.get("roster_title_mappings")).toBeUndefined();
  });

  it("copies params it cannot read as they are", async () => {
    const { db, inserted } = fakeDb(stage({ app_settings: [{ value: "not json" }] }));
    await startNewTerm(db, input);
    expect(inserted.get("app_settings")).toEqual([
      { key: "schedule_params:spring-2027", value: "not json" },
    ]);
  });

  it("starts with only an empty default group and the test group", async () => {
    const { db, inserted } = fakeDb(stage());
    await startNewTerm(db, input);

    const made = inserted.get("groups")!;
    expect(made).toHaveLength(2);
    expect(made[0]).toMatchObject({ termId: "spring-2027", kind: "default", isDefault: true });
    expect(made[0]!.opensAt).toBeUndefined();
    expect(made[1]).toMatchObject({
      id: "test-spring-2027",
      termId: "spring-2027",
      kind: "test",
      isDefault: false,
    });
  });

  it("carries the roster in no group, and only test accounts into the test group", async () => {
    const { db, inserted } = fakeDb(stage());
    const summary = await startNewTerm(db, input);

    const ids = Object.fromEntries(inserted.get("positions")!.map((p) => [p.name, p.id]));
    const members = inserted.get("term_members")!;
    const byEmail = Object.fromEntries(members.map((m) => [m.studentEmail, m]));

    // Off the roster and not a test account: left behind.
    expect(Object.keys(byEmail).sort()).toEqual(
      ["merged@wisc.edu", "on@wisc.edu", "real-in-test@wisc.edu", TEST_EMAIL].sort(),
    );
    expect(byEmail["on@wisc.edu"]).toEqual({
      termId: "spring-2027",
      studentEmail: "on@wisc.edu",
      positionId: ids.cashier,
      onRoster: true,
      rosterTitle: "Cashier",
      groupId: null,
      assignedAuto: false,
    });
    expect(byEmail["merged@wisc.edu"]!.positionId).toBe(ids.cashier);
    expect(byEmail[TEST_EMAIL]).toMatchObject({ groupId: "test-spring-2027", onRoster: false });
    // A real student who sat in the old test group gets no open form.
    expect(byEmail["real-in-test@wisc.edu"]).toMatchObject({ groupId: null, onRoster: true });

    expect(summary).toEqual({
      termId: "spring-2027",
      positions: 2,
      blocks: 2,
      members: 3,
      testAccounts: 1,
      leads: 2,
    });
  });

  it("starts from a term with nothing in it", async () => {
    const rows = stage({
      positions: [],
      shift_blocks: [],
      roster_title_mappings: [],
      w2w_position_map: [],
      app_settings: [],
      term_members: [],
    });
    const { db, inserted, pointerWrites } = fakeDb(rows);
    const summary = await startNewTerm(db, input);

    expect([...inserted.keys()].sort()).toEqual(["groups", "terms"]);
    expect(pointerWrites).toEqual(["spring-2027"]);
    expect(summary).toMatchObject({ positions: 0, blocks: 0, members: 0, testAccounts: 0 });
  });
});
