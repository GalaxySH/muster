import { beforeEach, describe, expect, it, vi } from "vitest";

// apply-change.ts is all I/O around two pure decisions (carryOverSelections and
// validateAvailability, both tested on their own). What is worth pinning here
// is the ORDER and the SCOPE of what it writes: the history row and the shift
// removal have to happen for a student with no submission at all, which is the
// case that produced a student showing scheduled hours over an empty grid.
vi.mock("./orphans", () => ({ syncOrphanedSelectionFlag: vi.fn().mockResolvedValue(0) }));

import { getTableName, type Table } from "drizzle-orm";
import { applyPositionChange } from "./apply-change";

const nameOf = (table: unknown) => getTableName(table as Table);

/**
 * Stand-in for a drizzle transaction handle. Reads are answered from a QUEUE
 * per table, not a single row set: `applyPositionChange` reads `shift_blocks`
 * twice with different filters (the target position's blocks, then the blocks
 * the student's rows actually point at), and a fake that returned the same
 * rows to both would quietly test nothing. A table with one queued entry
 * replays it for every read.
 */
function fakeTx(queues: Record<string, unknown[][]>) {
  const pending: Record<string, unknown[][]> = Object.fromEntries(
    Object.entries(queues).map(([k, v]) => [k, [...v]]),
  );
  const log = {
    reads: [] as string[],
    writes: [] as string[],
    inserted: [] as { table: string; values: unknown }[],
    updated: [] as { table: string; set: unknown }[],
  };

  const next = (table: string): unknown[] => {
    const queue = pending[table];
    if (!queue || queue.length === 0) return [];
    return (queue.length === 1 ? queue[0] : queue.shift()) ?? [];
  };

  const select = () => {
    let table = "";
    const chain = {
      from(t: unknown) {
        table = nameOf(t);
        log.reads.push(table);
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (fulfil?: (rows: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(next(table)).then(fulfil, reject),
    };
    return chain;
  };

  const tx = {
    select,
    insert: (t: unknown) => {
      const table = nameOf(t);
      return {
        values: async (values: unknown) => {
          log.writes.push(`insert:${table}`);
          log.inserted.push({ table, values });
        },
      };
    },
    update: (t: unknown) => {
      const table = nameOf(t);
      return {
        set: (set: unknown) => ({
          where: async () => {
            log.writes.push(`update:${table}`);
            log.updated.push({ table, set });
          },
        }),
      };
    },
    delete: (t: unknown) => {
      const table = nameOf(t);
      return {
        where: async () => {
          log.writes.push(`delete:${table}`);
        },
      };
    },
  };
  return { tx, log };
}

const POSITION_ROWS = [
  { id: "dishwasher", name: "Dishwasher" },
  { id: "culinary-assistant", name: "Culinary Assistant" },
];

const CHANGE = {
  email: "jane@wisc.edu",
  fromPositionId: "dishwasher",
  toPositionId: "culinary-assistant",
  source: "roster_import" as const,
  changedBy: "admin@wisc.edu",
};

const run = (queues: Record<string, unknown[][]>, input = CHANGE) => {
  const { tx, log } = fakeTx(queues);
  return applyPositionChange(tx as never, input).then((result) => ({ result, log }));
};

beforeEach(() => vi.clearAllMocks());

describe("applyPositionChange, for a student with no submission", () => {
  // The regression this whole routine exists for: a position and a schedule row
  // hang off the email, so a missing submission must not skip either of them.
  const noSubmission = {
    positions: [POSITION_ROWS],
    schedule_runs: [[{ id: "run-1" }]],
    schedule_assignments: [[{ blockId: "dishwasher-wd-430p-8p" }, { blockId: "dishwasher-wd-745p-1130p" }]],
    submissions: [[]],
  };

  it("still records the change", async () => {
    const { result, log } = await run(noSubmission);
    expect(result.hadSubmission).toBe(false);

    const history = log.inserted.find((w) => w.table === "position_changes");
    expect(history?.values).toMatchObject({
      studentEmail: "jane@wisc.edu",
      fromPositionId: "dishwasher",
      fromPositionName: "Dishwasher",
      toPositionId: "culinary-assistant",
      toPositionName: "Culinary Assistant",
      source: "roster_import",
      changedBy: "admin@wisc.edu",
    });
  });

  it("still removes the shifts the old position left behind", async () => {
    const { result, log } = await run(noSubmission);
    expect(result.removedShifts).toBe(2);
    expect(log.writes).toContain("delete:schedule_assignments");
  });

  it("touches no submission-side state", async () => {
    const { log } = await run(noSubmission);
    expect(log.writes).not.toContain("insert:flags");
    expect(log.writes).not.toContain("update:submissions");
    expect(log.writes).not.toContain("delete:shift_selections");
  });

  it("records the change before it removes anything", async () => {
    const { log } = await run(noSubmission);
    expect(log.writes.indexOf("insert:position_changes")).toBeLessThan(
      log.writes.indexOf("delete:schedule_assignments"),
    );
  });
});

describe("applyPositionChange, shift removal", () => {
  it("removes nothing when no run is current", async () => {
    const { result, log } = await run({
      positions: [POSITION_ROWS],
      schedule_runs: [[]],
      submissions: [[]],
    });
    expect(result.removedShifts).toBe(0);
    expect(log.writes).not.toContain("delete:schedule_assignments");
    // Never even looked: no current run means nothing to scope a delete to.
    expect(log.reads).not.toContain("schedule_assignments");
  });

  it("removes nothing when the current run holds no shifts for them", async () => {
    const { result, log } = await run({
      positions: [POSITION_ROWS],
      schedule_runs: [[{ id: "run-1" }]],
      schedule_assignments: [[]],
      submissions: [[]],
    });
    expect(result.removedShifts).toBe(0);
    expect(log.writes).not.toContain("delete:schedule_assignments");
  });
});

describe("applyPositionChange, for a student with a submission", () => {
  // One pick at 8a-12p that the new position also runs, and one at 11a-3p that
  // it does not. Queued so the target-block read and the source-block read
  // inside the carry-over get different answers.
  const withSubmission = {
    positions: [POSITION_ROWS],
    schedule_runs: [[{ id: "run-1" }]],
    schedule_assignments: [[{ blockId: "dishwasher-wd-8a-12p" }]],
    submissions: [[{ id: "sub-1" }], [{ everyWeekendOptIn: false, desiredHours: 10, positionId: "culinary-assistant" }]],
    shift_blocks: [
      // Target blocks for the carry-over.
      [{ id: "ca-wd-8a-12p", positionId: "culinary-assistant", dayType: "weekday", startMinutes: 480, endMinutes: 720, retiredAt: null }],
      // Source blocks the student's rows point at.
      [
        { id: "dw-wd-8a-12p", positionId: "dishwasher", dayType: "weekday", startMinutes: 480, endMinutes: 720, retiredAt: null },
        { id: "dw-wd-11a-3p", positionId: "dishwasher", dayType: "weekday", startMinutes: 660, endMinutes: 900, retiredAt: null },
      ],
    ],
    shift_selections: [
      [
        { blockId: "dw-wd-8a-12p", day: "mon", autoAssigned: false },
        { blockId: "dw-wd-11a-3p", day: "tue", autoAssigned: false },
      ],
    ],
    internal_selections: [[]],
    internal_availability: [[]],
  };

  it("carries the matching pick over and leaves the unmatched one in place", async () => {
    const { result } = await run(withSubmission);
    expect(result.carriedOver).toBe(1);
    // Not deleted. It stays on the old block, where it reads as an orphan the
    // admin can see and clear.
    expect(result.preserved).toBe(1);
  });

  it("clears the scheduled marker, since the schedule behind it is gone", async () => {
    const { log } = await run(withSubmission);
    expect(log.updated).toContainEqual({ table: "submissions", set: { scheduled: false } });
  });

  it("replaces the position_change flag rather than stacking one", async () => {
    const { log } = await run(withSubmission);
    expect(log.writes.indexOf("delete:flags")).toBeLessThan(log.writes.indexOf("insert:flags"));
    const flag = log.inserted.find(
      (w) => w.table === "flags" && (w.values as { type: string }).type === "position_change",
    );
    expect((flag?.values as { detail: string }).detail).toContain(
      "Position changed from Dishwasher to Culinary Assistant.",
    );
  });

  it("names the preserved picks and the removed shifts in the flag detail", async () => {
    const { log } = await run(withSubmission);
    const flag = log.inserted.find(
      (w) => w.table === "flags" && (w.values as { type: string }).type === "position_change",
    );
    const detail = (flag?.values as { detail: string }).detail;
    expect(detail).toContain("1 pick moved to the new position.");
    expect(detail).toContain("1 pick did not fit and stayed on the old position.");
    expect(detail).toContain("1 scheduled shift was removed.");
  });
});

describe("applyPositionChange, into a position with no blocks yet", () => {
  const deferred = {
    positions: [POSITION_ROWS],
    schedule_runs: [[]],
    submissions: [[{ id: "sub-1" }]],
    shift_blocks: [[]],
  };

  it("defers the carry-over and leaves every pick alone", async () => {
    const { result, log } = await run(deferred);
    expect(result.deferred).toBe(true);
    expect(result.carriedOver).toBe(0);
    expect(log.writes).not.toContain("delete:shift_selections");
  });

  it("says so in the flag rather than reporting a move", async () => {
    const { log } = await run(deferred);
    const flag = log.inserted.find(
      (w) => w.table === "flags" && (w.values as { type: string }).type === "position_change",
    );
    expect((flag?.values as { detail: string }).detail).toContain(
      "Culinary Assistant has no shifts set up yet, so shift picks are unchanged.",
    );
  });
});
