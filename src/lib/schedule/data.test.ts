import { beforeEach, describe, expect, it, vi } from "vitest";

// data.ts is the schedule read layer: every collaborator below it is I/O. Stub
// the DB handle so the roster filtering, which is the whole point of these
// tests, can be exercised in node against a recorded query log.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getDb } from "@/lib/db";
import type { StoredRunReport, StudentScheduleReport } from "@/lib/domain/scheduling/types";
import { eligibleSubmittedFilter, loadScheduleForRun, type ScheduleRunRow } from "./data";
import { onRosterStudent } from "@/lib/roster/lookup";

const nameOf = (table: unknown) => getTableName(table as Table);
const render = (clause: unknown) => new MySqlDialect().sqlToQuery(clause as SQL).sql;

interface Read {
  table: string;
  joins: string[];
  where: string;
}

interface QueryChain {
  from(table: unknown): QueryChain;
  innerJoin(...args: unknown[]): QueryChain;
  leftJoin(...args: unknown[]): QueryChain;
  where(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: rows are keyed by the table each read
 * selects FROM, and every read is logged with its joined tables and its
 * rendered WHERE. The fake cannot execute SQL, so a filter that lives in the
 * WHERE is pinned by reading it back off that log; a filter applied in JS is
 * pinned by the rows the loader returns.
 */
function fakeDb(rows: Record<string, unknown[]>) {
  const reads: Read[] = [];
  const select = (): QueryChain => {
    const read: Read = { table: "", joins: [], where: "" };
    const chain: QueryChain = {
      from(t) {
        read.table = nameOf(t);
        reads.push(read);
        return chain;
      },
      innerJoin: (t: unknown) => {
        read.joins.push(nameOf(t));
        return chain;
      },
      leftJoin: (t: unknown) => {
        read.joins.push(nameOf(t));
        return chain;
      },
      where: (clause: unknown) => {
        read.where = render(clause);
        return chain;
      },
      then: (fulfil, reject) => Promise.resolve(rows[read.table] ?? []).then(fulfil, reject),
    };
    return chain;
  };
  return { handle: { select: () => select() }, reads };
}

const reportStudent = (
  email: string,
  over: Partial<StudentScheduleReport> = {},
): StudentScheduleReport => ({
  email,
  targetMinutes: 600,
  assignedMinutes: 600,
  daysUsed: 2,
  cohort: null,
  frozen: false,
  ...over,
});

const storedReport = (over: Partial<StoredRunReport> = {}): StoredRunReport => ({
  students: [],
  droppedStudents: [],
  droppedBlockGone: 0,
  skippedNoPosition: [],
  shortOfTarget: 0,
  belowMinDays: 0,
  ...over,
});

const runRow = (report: StoredRunReport): ScheduleRunRow =>
  ({
    id: "run-1",
    generatedAt: new Date("2026-08-01T12:00:00Z"),
    generatedBy: "admin@wisc.edu",
    status: "current",
    summaryJson: JSON.stringify(report),
    scopeJson: null,
  }) as unknown as ScheduleRunRow;

const assignmentRow = (email: string, day = "mon", blockId = "blk-1") => ({
  studentEmail: email,
  day,
  cohort: "weekday",
  dayType: "weekday",
  start: 600,
  end: 900,
  blockId,
  source: "engine",
});

const infoRow = (email: string, displayName: string, onRoster: boolean) => ({
  email,
  displayName,
  positionId: "cashier",
  positionName: "Cashier",
  minDays: 2,
  minHours: 10,
  international: false,
  onRoster,
  scheduled: false,
});

describe("eligibleSubmittedFilter", () => {
  it("composes the shared roster predicate with the submitted check", () => {
    expect(render(eligibleSubmittedFilter())).toBe(
      `(${render(onRosterStudent())} and \`submissions\`.\`status\` = ?)`,
    );
  });
});

describe("loadScheduleForRun", () => {
  beforeEach(() => vi.mocked(getDb).mockReset());

  const load = (rows: Record<string, unknown[]>, report: StoredRunReport) => {
    const { handle, reads } = fakeDb(rows);
    vi.mocked(getDb).mockReturnValue(handle as unknown as ReturnType<typeof getDb>);
    return { result: loadScheduleForRun(runRow(report)), reads };
  };

  it("reads the run's assignment rows through students, filtered to the roster", async () => {
    const { result, reads } = load({}, storedReport());
    await result;

    const assignments = reads.find((r) => r.table === "schedule_assignments");
    expect(assignments).toBeDefined();
    expect(assignments!.joins).toContain("students");
    expect(assignments!.where).toContain(render(onRosterStudent()));
  });

  it("drops students who have left the roster and reports how many", async () => {
    const report = storedReport({
      students: [reportStudent("stays@wisc.edu"), reportStudent("left@wisc.edu")],
    });
    const { result } = load(
      {
        // The departed student's rows are gone because the query above filtered
        // them; the fake stands in for that result.
        schedule_assignments: [assignmentRow("stays@wisc.edu")],
        students: [
          infoRow("stays@wisc.edu", "Stays Here", true),
          infoRow("left@wisc.edu", "Left Us", false),
        ],
      },
      report,
    );
    const schedule = await result;

    expect(schedule.students.map((s) => s.email)).toEqual(["stays@wisc.edu"]);
    expect(schedule.offRosterStudents).toBe(1);
    // The page's headline counts read the returned report, so it has to shrink
    // with the student list rather than keep counting people with no shifts.
    expect(schedule.report.students.map((s) => s.email)).toEqual(["stays@wisc.edu"]);
    expect(schedule.totalAssignments).toBe(1);
  });

  it("counts a student whose roster row is gone entirely", async () => {
    const { result } = load(
      {
        schedule_assignments: [],
        students: [],
      },
      storedReport({ students: [reportStudent("vanished@wisc.edu")] }),
    );
    const schedule = await result;

    expect(schedule.students).toEqual([]);
    expect(schedule.offRosterStudents).toBe(1);
  });

  it("says nothing when everyone in the run is still on the roster", async () => {
    const { result } = load(
      {
        schedule_assignments: [assignmentRow("stays@wisc.edu")],
        students: [infoRow("stays@wisc.edu", "Stays Here", true)],
      },
      storedReport({ students: [reportStudent("stays@wisc.edu")] }),
    );
    const schedule = await result;

    expect(schedule.offRosterStudents).toBe(0);
    expect(schedule.students.map((s) => s.displayName)).toEqual(["Stays Here"]);
  });

  it("still names the people the run dropped for leaving the roster", async () => {
    const { result, reads } = load(
      {
        schedule_assignments: [],
        students: [infoRow("left@wisc.edu", "Left Us", false)],
      },
      storedReport({ droppedStudents: ["left@wisc.edu"] }),
    );
    const schedule = await result;

    // The name lookup is deliberately NOT roster-filtered: the dropped warning
    // exists to report exactly these people, and filtering it would reduce the
    // line to a list of email addresses.
    const info = reads.find((r) => r.table === "students");
    expect(info!.where).not.toContain(render(onRosterStudent()));
    const dropped = schedule.problems.find((g) => g.kind === "dropped");
    expect(dropped!.students).toEqual([{ email: "left@wisc.edu", name: "Left Us" }]);
  });
});
