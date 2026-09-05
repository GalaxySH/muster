import { beforeEach, describe, expect, it, vi } from "vitest";

// The plan import is a server-action module: the admin gate, the DB handle,
// cache revalidation, the Drive sheet relay and the match inputs are all I/O.
// Everything else is left real, so one upload goes through the actual parse,
// match and run building on its way to the recorded write log.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/w2w/plan-data", () => ({ loadPlanMatchInputs: vi.fn() }));
vi.mock("./sheet-sync", () => ({ SCHEDULE_SHEET: "schedule", trySyncSheet: vi.fn() }));

import { getTableName, type Table } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db";
import { loadPlanMatchInputs } from "@/lib/w2w/plan-data";
import { listScheduleRuns } from "@/lib/schedule/data";
import { importShiftPlanFromUpload } from "./plan-import-actions";

const nameOf = (table: unknown) => getTableName(table as Table);

interface Write {
  op: "insert" | "update" | "delete";
  table: string;
  values?: Record<string, unknown>;
  all?: Record<string, unknown>[];
}

interface QueryChain {
  from(table: unknown): QueryChain;
  innerJoin(...args: unknown[]): QueryChain;
  leftJoin(...args: unknown[]): QueryChain;
  where(...args: unknown[]): QueryChain;
  orderBy(...args: unknown[]): QueryChain;
  groupBy(...args: unknown[]): QueryChain;
  limit(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: reads answer from `rows` keyed by the table
 * they select FROM, and every write is logged in order with the values it
 * carried, so a refusal can be told from a rolled-back write by whether the
 * log is empty.
 */
function fakeDb(rows: Record<string, unknown[]> = {}) {
  const writes: Write[] = [];
  const select = (): QueryChain => {
    let table = "";
    const chain: QueryChain = {
      from(t) {
        table = nameOf(t);
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      then: (fulfil, reject) => Promise.resolve(rows[table] ?? []).then(fulfil, reject),
    };
    return chain;
  };
  const done = (write: Write) => {
    const chain = {
      where: () => chain,
      then: (fulfil?: (r: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve([{ affectedRows: 0 }]).then(fulfil, reject),
    };
    writes.push(write);
    return chain;
  };
  const handle = {
    select: () => select(),
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) =>
        done({
          op: "insert" as const,
          table: nameOf(t),
          values: Array.isArray(v) ? v[0] : v,
          all: Array.isArray(v) ? v : [v],
        }),
    }),
    update: (t: unknown) => ({
      set: (v: Record<string, unknown>) =>
        done({ op: "update" as const, table: nameOf(t), values: v }),
    }),
    delete: (t: unknown) => done({ op: "delete" as const, table: nameOf(t) }),
    transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(handle),
  };
  return { handle, writes };
}

const PLAN_HEADER =
  '"Shift ID","Schedule ID","Employee Number","Position ID","Position Name",' +
  '"Category","Shift Description","Date","Start Time","End Time","Duration",' +
  '"Day Of Week","Employee Name"';

// A Monday CA seat taken by Ada with an open one beside it, a second Monday
// shift for Ada that OVERLAPS the first by an hour, Bob on Tuesday, and a shift
// on a position Muster does not map. 12/21/2026 is a Monday.
const PLAN_CSV =
  [
    PLAN_HEADER,
    '555001,9001,,762431352,"GDEC - CA",,,12/21/2026,08:00 AM,11:00 AM,3.00,1,"Ada Lovelace"',
    '555002,9001,,762431352,"GDEC - CA",,,12/21/2026,08:00 AM,11:00 AM,3.00,1,',
    '555003,9001,,762431352,"GDEC - CA",,,12/21/2026,10:00 AM,01:00 PM,3.00,1,"Ada Lovelace"',
    '555004,9001,,762431352,"GDEC - CA",,,12/22/2026,08:00 AM,11:00 AM,3.00,2,"Bob Bell"',
    '555005,9001,,999,"GDEC - Mystery",,,12/22/2026,09:00 AM,12:00 PM,3.00,2,"Ada Lovelace"',
  ].join("\n") + "\n";

const ROSTER = {
  students: [
    {
      email: "ada@wisc.edu",
      displayName: "Lovelace, Ada",
      positionId: "culinary-assistant",
      international: false,
      everyWeekendOptIn: false,
      desiredHours: 12,
    },
    // No position: nothing to target them against, the same zero the engine
    // reports for a student it cannot aim at.
    {
      email: "bob@wisc.edu",
      displayName: "Bell, Bob",
      positionId: null,
      international: false,
      everyWeekendOptIn: null,
      desiredHours: null,
    },
    {
      email: "cara@wisc.edu",
      displayName: "Cruz, Cara",
      positionId: "culinary-assistant",
      international: false,
      everyWeekendOptIn: false,
      desiredHours: null,
    },
  ],
  positions: [{ id: "culinary-assistant", minHours: 10, minDays: 2 }],
};

function upload(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("file", new File([PLAN_CSV], "export.csv", { type: "text/csv" }));
  form.set("rotationWeek", "a");
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

const useDb = (rows: Record<string, unknown[]> = ROSTER) => {
  const { handle, writes } = fakeDb(rows);
  vi.mocked(getDb).mockReturnValue(handle as never);
  return writes;
};

const writesTo = (writes: Write[], table: string, op: Write["op"]) =>
  writes.filter((w) => w.table === table && w.op === op);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "admin@wisc.edu" });
  vi.mocked(loadPlanMatchInputs).mockResolvedValue({
    map: [
      {
        w2wPositionId: "762431352",
        w2wPositionName: "GDEC - CA",
        musterPositionId: "culinary-assistant",
        fillOrder: 0,
      },
    ],
    blocks: [
      {
        id: "ca-wd",
        positionId: "culinary-assistant",
        dayType: "weekday",
        start: 480,
        end: 660,
        desiredCapacity: 1,
      },
      {
        id: "ca-late",
        positionId: "culinary-assistant",
        dayType: "weekday",
        start: 600,
        end: 780,
        desiredCapacity: 1,
      },
      // Only the weekend plan below touches this one.
      {
        id: "ca-we",
        positionId: "culinary-assistant",
        dayType: "weekend",
        start: 480,
        end: 660,
        desiredCapacity: 1,
      },
    ],
    positionNames: new Map([["culinary-assistant", "Culinary Assistant"]]),
  });
});

describe("importShiftPlanFromUpload", () => {
  it("refuses a signed-in non-admin without touching the database", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    expect(await importShiftPlanFromUpload(upload())).toEqual({ ok: false, error: "Admins only." });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not signed in", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "You are not signed in." });
    expect(await importShiftPlanFromUpload(upload())).toEqual({
      ok: false,
      error: "You are not signed in.",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses an upload with no rotation week", async () => {
    const form = upload();
    form.delete("rotationWeek");
    const writes = useDb();
    expect(await importShiftPlanFromUpload(form)).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("shows the delta and writes nothing until the import is confirmed", async () => {
    const writes = useDb();
    const res = await importShiftPlanFromUpload(upload({ createRun: "1" }));

    expect(writes).toEqual([]);
    expect(res.applied).toBeUndefined();
    expect(res.preview).toMatchObject({
      rowCount: 5,
      matchedCount: 4,
      assignedRowCount: 4,
      unmatchedRowCount: 1,
      createRun: true,
    });
    // The row on the unmapped position never becomes an assignment, so Ada
    // holds two shifts, Bob one, and Cara is a roster student the plan forgot.
    expect(res.preview?.run).toMatchObject({
      assignments: 3,
      students: 2,
      noAssignments: { total: 1, sample: ["cara@wisc.edu"] },
    });
    expect(res.preview?.unknownPositions.sample).toEqual(["GDEC - Mystery (999)"]);
  });

  it("names an employee no student answers to", async () => {
    useDb({ ...ROSTER, students: [ROSTER.students[1]!] });
    const res = await importShiftPlanFromUpload(upload());
    expect(res.preview?.run.unassociated).toEqual({
      total: 1,
      sample: ["Ada Lovelace (no match)"],
    });
  });

  it("stores the plan on confirm and leaves the schedule alone by default", async () => {
    const writes = useDb();
    const res = await importShiftPlanFromUpload(upload({ confirm: "1" }));

    expect(res.applied).toEqual({ capacityUpdated: 0, runAssignments: null });
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual([
      "update:shift_plans",
      "insert:shift_plans",
      "insert:shift_plan_rows",
    ]);
    expect(writesTo(writes, "shift_plans", "insert")[0]?.values).toMatchObject({
      importedBy: "admin@wisc.edu",
      rowCount: 5,
      rotationWeek: "a",
    });
  });

  it("makes the plan's names the current schedule when asked", async () => {
    const writes = useDb();
    const res = await importShiftPlanFromUpload(upload({ confirm: "1", createRun: "1" }));
    expect(res.applied).toEqual({ capacityUpdated: 0, runAssignments: 3 });

    // The flip comes first, then the new row: no window with two current runs.
    const [flip] = writesTo(writes, "schedule_runs", "update");
    expect(flip?.values).toEqual({ status: "superseded" });
    const [run] = writesTo(writes, "schedule_runs", "insert");
    expect(run?.values).toMatchObject({
      status: "current",
      generatedBy: "admin@wisc.edu",
      // Nothing was solved here, and a transcription is never a slice.
      kind: "snapshot",
      scopeJson: null,
    });
    expect(writes.indexOf(flip!)).toBeLessThan(writes.indexOf(run!));

    // A human wrote these in W2W, so the rows are manual, not the engine's.
    const runId = run!.values!.id;
    expect(writesTo(writes, "schedule_assignments", "insert")[0]?.all).toEqual([
      {
        runId,
        studentEmail: "ada@wisc.edu",
        shiftBlockId: "ca-late",
        day: "mon",
        cohort: "weekday",
        source: "manual",
      },
      {
        runId,
        studentEmail: "ada@wisc.edu",
        shiftBlockId: "ca-wd",
        day: "mon",
        cohort: "weekday",
        source: "manual",
      },
      {
        runId,
        studentEmail: "bob@wisc.edu",
        shiftBlockId: "ca-wd",
        day: "tue",
        cohort: "weekday",
        source: "manual",
      },
    ]);
  });

  it("measures the hours the run actually gives, without double counting", async () => {
    const writes = useDb();
    await importShiftPlanFromUpload(upload({ confirm: "1", createRun: "1" }));
    const [run] = writesTo(writes, "schedule_runs", "insert");
    const report = JSON.parse(String(run!.values!.summaryJson));

    // The schedule page counts placed students off assignedMinutes, not off the
    // rows, so a student holding shifts must come back with minutes on them.
    expect(report.students).toHaveLength(2);
    for (const s of report.students) expect(s.assignedMinutes).toBeGreaterThan(0);

    const ada = report.students.find((s: { email: string }) => s.email === "ada@wisc.edu");
    // 8 to 11 and 10 to 1 overlap by an hour: 8 to 1 is five hours, not six.
    expect(ada).toMatchObject({
      assignedMinutes: 300,
      // 12 desired hours, inside the floor and the cap.
      targetMinutes: 720,
      daysUsed: 1,
      cohort: null,
      frozen: false,
    });
    // No position, so no floor and nothing to aim at.
    expect(
      report.students.find((s: { email: string }) => s.email === "bob@wisc.edu"),
    ).toMatchObject({ assignedMinutes: 180, targetMinutes: 0 });

    // Counted, not assumed: Ada is short of 12 hours and short of her two-day
    // minimum; Bob has no position to be measured against.
    expect(report).toMatchObject({ shortOfTarget: 1, belowMinDays: 1 });
  });

  it("stores a report the run history can read back and label", async () => {
    const writes = useDb();
    await importShiftPlanFromUpload(upload({ confirm: "1", createRun: "1" }));
    const [run] = writesTo(writes, "schedule_runs", "insert");

    // The stored JSON goes back through listScheduleRuns, which parses it
    // unguarded: a report missing a field it reads takes the whole table down.
    const reader = fakeDb({
      schedule_runs: [
        {
          ...run!.values,
          generatedAt: new Date("2026-09-05T12:00:00Z"),
          pinned: false,
          restoredAt: null,
          restoredBy: null,
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(reader.handle as never);

    const [listed] = await listScheduleRuns();
    expect(listed).toMatchObject({
      students: 2,
      shortOfTarget: 1,
      belowMinHours: null,
      origin: "w2w-plan",
    });
    // No health snapshot: the panel falls back rather than reporting zeros.
    expect(JSON.parse(String(run!.values!.summaryJson)).stats).toBeUndefined();
  });
});

describe("the weekend rotation a transcribed run gives a student", () => {
  // One Saturday seat for Ada. 12/19/2026 is a Saturday.
  const WEEKEND_CSV =
    [
      PLAN_HEADER,
      '555010,9001,,762431352,"GDEC - CA",,,12/19/2026,08:00 AM,11:00 AM,3.00,6,"Ada Lovelace"',
    ].join("\n") + "\n";

  /**
   * Import the Saturday seat and report the cohort it wrote, with Ada's own
   * answer and the admin's internal copy set as given. The upload says week A,
   * so "a" is what alternating looks like here.
   */
  async function cohortFor(options: { ownOptIn: boolean; internalOptIn?: boolean }) {
    const { handle, writes } = fakeDb({
      ...ROSTER,
      students: [{ ...ROSTER.students[0]!, everyWeekendOptIn: options.ownOptIn }],
      internal_availability:
        options.internalOptIn === undefined
          ? []
          : [
              {
                email: "ada@wisc.edu",
                submissionId: "sub-1",
                everyWeekendOptIn: options.internalOptIn,
              },
            ],
    });
    vi.mocked(getDb).mockReturnValue(handle as never);

    const form = new FormData();
    form.set("file", new File([WEEKEND_CSV], "export.csv", { type: "text/csv" }));
    form.set("rotationWeek", "a");
    form.set("confirm", "1");
    form.set("createRun", "1");
    await importShiftPlanFromUpload(form);

    const [rows] = writesTo(writes, "schedule_assignments", "insert");
    return rows?.all?.[0]?.cohort;
  }

  it("follows the student when no admin copy exists", async () => {
    expect(await cohortFor({ ownOptIn: true })).toBe("every");
    expect(await cohortFor({ ownOptIn: false })).toBe("a");
  });

  it("lets an admin copy put a student on every weekend", async () => {
    expect(await cohortFor({ ownOptIn: false, internalOptIn: true })).toBe("every");
  });

  it("lets an admin copy take a student off every weekend", async () => {
    // The override runs in both directions: a copy is literal, so its false
    // means alternating and beats the student's own opt-in.
    expect(await cohortFor({ ownOptIn: true, internalOptIn: false })).toBe("a");
  });
});
