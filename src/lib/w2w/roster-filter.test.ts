import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Both W2W server reads used to pull the WHOLE `students` table with no filter,
 * so a student who left the roster could still absorb an imported W2W name (and
 * silence the warning that the plan gave that person shifts) or be handed shifts
 * in the auto-fill upload. These tests pin the filter on the reads themselves:
 * the fake handle cannot execute SQL, so it records each read's WHERE and the
 * assertion reads it back.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("./plan-data", () => ({ getCurrentPlan: vi.fn(), loadPlanMatchInputs: vi.fn() }));
// Stubbed inline rather than imported and mocked: W2W may not import the
// generator (eslint, docs/module-separation-plan.md), and that holds for its
// tests too.
vi.mock("@/lib/schedule/data", () => ({
  loadCurrentRunRow: async () => ({ id: "run-1", generatedAt: new Date("2026-08-02T00:00:00Z") }),
}));

import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getDb } from "@/lib/db";
import { onRosterStudent } from "@/lib/roster/lookup";
import type { W2wPlanRow } from "@/lib/domain/w2w-plan/types";
import { getCurrentPlan, loadPlanMatchInputs } from "./plan-data";
import { buildExportModel } from "./export-data";
import { loadRepairSeeds } from "./repair";

const nameOf = (table: unknown) => getTableName(table as Table);
const render = (clause: unknown) => new MySqlDialect().sqlToQuery(clause as SQL).sql;
const ROSTER_FILTER = render(onRosterStudent());

interface Read {
  table: string;
  wheres: string[];
}

interface QueryChain {
  from(table: unknown): QueryChain;
  innerJoin(...args: unknown[]): QueryChain;
  where(...args: unknown[]): QueryChain;
  orderBy(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/** Rows keyed by the table each read selects FROM, plus a log of every read. */
function fakeDb(rows: Record<string, unknown[]>) {
  const reads: Read[] = [];
  const select = (): QueryChain => {
    const read: Read = { table: "", wheres: [] };
    const chain: QueryChain = {
      from(t) {
        read.table = nameOf(t);
        reads.push(read);
        return chain;
      },
      innerJoin: () => chain,
      where: (clause: unknown) => {
        read.wheres.push(render(clause));
        return chain;
      },
      orderBy: () => chain,
      then: (fulfil, reject) => Promise.resolve(rows[read.table] ?? []).then(fulfil, reject),
    };
    return chain;
  };
  const handle = { select: () => select() };
  vi.mocked(getDb).mockReturnValue(handle as unknown as ReturnType<typeof getDb>);
  return reads;
}

/** Every read of `students`, so a test can assert none of them is unfiltered. */
const studentReads = (reads: Read[]) => reads.filter((r) => r.table === "students");

const planRow = (over: Partial<W2wPlanRow> = {}): W2wPlanRow => ({
  seq: 0,
  w2wPositionId: "77",
  w2wPositionName: "Cashier",
  category: "",
  description: "",
  day: "mon",
  startTime: "08:00 AM",
  endTime: "01:00 PM",
  duration: "5.00",
  startMinutes: 480,
  endMinutes: 780,
  // A name on the plan is what makes the export resolve imported names at all.
  employeeName: "Doe, Jane",
  employeeNumber: "",
  ...over,
});

const plan = {
  meta: {
    id: "plan-1",
    importedAt: new Date("2026-08-01T00:00:00Z"),
    importedBy: "admin@wisc.edu",
    sourceFilename: "week.csv",
    rowCount: 1,
    rotationWeek: "a" as const,
  },
  rows: [planRow()],
};

const matchInputs = { map: [], blocks: [], positionNames: new Map<string, string>() };

beforeEach(() => {
  vi.mocked(getDb).mockReset();
  vi.mocked(getCurrentPlan).mockResolvedValue(plan);
  vi.mocked(loadPlanMatchInputs).mockResolvedValue(matchInputs);
});

describe("buildExportModel", () => {
  it("reads only on-roster students for both the seat list and the name index", async () => {
    const reads = fakeDb({
      schedule_assignments: [
        { studentEmail: "stays@wisc.edu", blockId: "blk-1", day: "mon", cohort: "weekday" },
      ],
      students: [{ email: "stays@wisc.edu", displayName: "Stays, Here" }],
      w2w_employees: [],
    });

    await buildExportModel();

    // The assignment read is what decides who gets a shift in the uploaded file.
    const assignments = reads.find((r) => r.table === "schedule_assignments");
    expect(assignments!.wheres.join(" ")).toContain(ROSTER_FILTER);
    // No read of the roster may go out unfiltered: the whole-table one feeding
    // buildNameIndex is the leak this closes.
    expect(studentReads(reads).length).toBeGreaterThan(0);
    for (const read of studentReads(reads)) {
      expect(read.wheres.join(" ")).not.toBe("");
    }
    const nameIndexRead = studentReads(reads).find((r) =>
      r.wheres.some((w) => w === ROSTER_FILTER),
    );
    expect(nameIndexRead).toBeDefined();
  });
});

describe("loadRepairSeeds", () => {
  it("resolves plan names against the current roster only", async () => {
    const reads = fakeDb({ students: [], w2w_employees: [] });

    await loadRepairSeeds(new Map(), 8 * 60);

    const roster = studentReads(reads);
    expect(roster.map((r) => r.wheres)).toEqual([[ROSTER_FILTER]]);
  });
});
