import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

// actions.ts is a server-action module whose collaborators are all I/O (the
// gate, the DB handle, the sheet sync, the flag syncs). Stub them so the two
// admin answer edits can be exercised in node. `checkDesiredHours` stays real:
// it is the floor rule the desired-hours edit has to share with the form.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/groups/gate", () => ({ requireEditableStudent: vi.fn() }));
vi.mock("@/lib/evidence/data", () => ({ ensureSubmissionId: vi.fn() }));
vi.mock("@/lib/positions/apply-change", () => ({ syncRevalidationFlag: vi.fn() }));
vi.mock("@/lib/positions/orphans", () => ({ syncOrphanedSelectionFlag: vi.fn() }));
vi.mock("@/lib/closes/data", () => ({
  countCloseClaims: vi.fn(),
  loadCloseRequirement: vi.fn(),
}));
// Held here rather than imported: the sheet sync is console code, and this
// folder may not import it (only actions.ts has that edge, on the allowlist).
const { trySyncSheet } = vi.hoisted(() => ({ trySyncSheet: vi.fn() }));
vi.mock("@/lib/admin/sheet-sync", () => ({ trySyncSheet, RESPONSES_SHEET: "responses" }));
vi.mock("./data", () => ({ loadPositionWithBlocks: vi.fn() }));

import { getDb } from "@/lib/db";
import { requireEditableStudent } from "@/lib/groups/gate";
import { ensureSubmissionId } from "@/lib/evidence/data";
import { syncRevalidationFlag } from "@/lib/positions/apply-change";
import { countCloseClaims, loadCloseRequirement } from "@/lib/closes/data";
import { workingTermId } from "@/lib/terms/working";
import { loadPositionWithBlocks } from "./data";
import {
  finalizeSubmission,
  saveAvailability,
  saveDesiredHoursFor,
  saveStudentNotesFor,
} from "./actions";

const STUDENT = "stu@wisc.edu";
const POSITION = { id: "ca", name: "Culinary", minHours: 10, minDays: 2, weekendExempt: false };

/**
 * Stand-in for the drizzle handle: answers the one submission read with
 * `existing` (empty = no submission yet) and logs every column set it updates,
 * inside or outside a transaction.
 */
function useDb(existing: { id: string; status: "draft" | "submitted" }[]) {
  const updates: Record<string, unknown>[] = [];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => existing,
  };
  const db = {
    select: () => chain,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return updates;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEditableStudent).mockResolvedValue({
    ok: true,
    email: STUDENT,
    positionId: "ca",
    onBehalf: true,
    termId: "test-term",
  });
  vi.mocked(ensureSubmissionId).mockResolvedValue("new-sub");
  vi.mocked(loadPositionWithBlocks).mockResolvedValue({ position: POSITION, blocks: [] });
});

describe("saveDesiredHoursFor", () => {
  it("overwrites the student's answer without moving updated_at", async () => {
    const updates = useDb([{ id: "sub-1", status: "submitted" }]);

    expect(await saveDesiredHoursFor(STUDENT, 15, "test-term")).toEqual({ ok: true });
    expect(requireEditableStudent).toHaveBeenCalledWith(STUDENT, "test-term");
    expect(updates).toEqual([{ desiredHours: 15 }]);
    // It is one of the revalidation checks, and a submitted row is in the sheet.
    expect(syncRevalidationFlag).toHaveBeenCalledWith(expect.anything(), "sub-1");
    expect(trySyncSheet).toHaveBeenCalledWith("responses", "test-term");
  });

  it("refuses anything under the position floor, as the form does", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    const res = await saveDesiredHoursFor(STUDENT, 9, "test-term");
    expect(res).toEqual({ ok: false, error: "Must be at least 10h." });
    expect(updates).toEqual([]);
  });

  it("refuses a fraction of an hour", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    expect((await saveDesiredHoursFor(STUDENT, 12.5, "test-term")).ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("clears the answer on null", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    expect(await saveDesiredHoursFor(STUDENT, null, "test-term")).toEqual({ ok: true });
    expect(updates).toEqual([{ desiredHours: null }]);
    expect(trySyncSheet).not.toHaveBeenCalled();
  });

  it("starts a stub for a student with no submission, with nothing to revalidate", async () => {
    const updates = useDb([]);
    expect(await saveDesiredHoursFor(STUDENT, 12, "test-term")).toEqual({ ok: true });
    expect(ensureSubmissionId).toHaveBeenCalledWith(STUDENT, "test-term");
    expect(updates).toEqual([{ desiredHours: 12 }]);
    expect(syncRevalidationFlag).not.toHaveBeenCalled();
    expect(trySyncSheet).not.toHaveBeenCalled();
  });

  it("goes nowhere when the gate refuses", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    vi.mocked(requireEditableStudent).mockResolvedValue({
      ok: false,
      error: "Only admins can fill in the form for someone else.",
    });
    expect((await saveDesiredHoursFor(STUDENT, 12, "test-term")).ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("never falls back to the caller's own form on a blank student", async () => {
    useDb([]);
    expect((await saveDesiredHoursFor("  ", 12, "test-term")).ok).toBe(false);
    expect(requireEditableStudent).not.toHaveBeenCalled();
  });
});

describe("saveStudentNotesFor", () => {
  it("trims the note and leaves updated_at alone", async () => {
    const updates = useDb([{ id: "sub-1", status: "submitted" }]);
    expect(await saveStudentNotesFor(STUDENT, "  Mornings only \n", "test-term")).toEqual({ ok: true });
    expect(updates).toEqual([{ studentNotes: "Mornings only" }]);
    expect(syncRevalidationFlag).not.toHaveBeenCalled();
    expect(trySyncSheet).toHaveBeenCalled();
  });

  it("stores an emptied note as null", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    await saveStudentNotesFor(STUDENT, "   ", "test-term");
    expect(updates).toEqual([{ studentNotes: null }]);
  });

  it("never falls back to the caller's own form on a blank student", async () => {
    useDb([]);
    expect((await saveStudentNotesFor("", "hi", "test-term")).ok).toBe(false);
    expect(requireEditableStudent).not.toHaveBeenCalled();
  });
});

describe("saveAvailability", () => {
  afterEach(() => {
    vi.mocked(workingTermId).mockImplementation(async () => "test-term");
  });

  /**
   * The working term answers "A" and then "B", as if a semester started while
   * the save ran. The gate stands in for the real one: it resolves the term
   * once and hands it back, which is all the action may use.
   */
  function termMovesAfterGate() {
    const answers = ["A", "B"];
    vi.mocked(workingTermId).mockImplementation(async () => answers.shift() ?? "test-term");
    vi.mocked(requireEditableStudent).mockImplementation(async () => ({
      ok: true,
      email: STUDENT,
      positionId: "ca",
      onBehalf: false,
      termId: await workingTermId(),
    }));
  }

  /**
   * A drizzle stand-in that answers a submissions read with `existing`, any read
   * with no limit from `unlimited` by table, and logs submission reads and inserts.
   */
  function recordingDb(existing: object[], unlimited: Record<string, unknown[]> = {}) {
    const lookups: unknown[] = [];
    const inserted: { table: string; values: unknown }[] = [];
    const db = {
      select: () => {
        let table = "";
        const chain = {
          from(t: unknown) {
            table = getTableName(t as Table);
            return chain;
          },
          where(clause: unknown) {
            if (table === "submissions") lookups.push(clause);
            return chain;
          },
          limit: async () => (table === "submissions" ? existing : []),
          // A read with no limit (selections, late travel) finds `unlimited`'s rows.
          then: (resolve: (rows: unknown[]) => unknown) => resolve(unlimited[table] ?? []),
        };
        return chain;
      },
      insert: (t: unknown) => ({
        values: async (values: unknown) => {
          inserted.push({ table: getTableName(t as Table), values });
        },
      }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
      delete: () => ({ where: async () => {} }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    return { lookups, inserted };
  }

  const draftSave = () =>
    saveAvailability({
      selection: [],
      everyWeekendOptIn: false,
      desiredHours: null,
      notes: "",
      mode: "draft",
    });

  // The student's save takes its term from the gate, before its transaction,
  // so the submission it reads and the one it writes are always in the same term.
  it("resolves the term once and uses it for the lookup and the insert", async () => {
    termMovesAfterGate();
    const { lookups, inserted } = recordingDb([]);

    const res = await saveAvailability({
      selection: [],
      everyWeekendOptIn: false,
      desiredHours: null,
      notes: "",
      mode: "draft",
    });

    expect(res.ok).toBe(true);
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(lookups).toHaveLength(1);
    expect(new MySqlDialect().sqlToQuery(lookups[0] as SQL).params).toEqual([STUDENT, "A"]);
    expect(inserted.filter((i) => i.table === "submissions")).toEqual([
      { table: "submissions", values: expect.objectContaining({ termId: "A" }) },
    ]);
  });

  it("refreshes the responses sheet of the term it saved in", async () => {
    termMovesAfterGate();
    const { lookups } = recordingDb([{ id: "sub-1", status: "submitted" }]);

    expect((await draftSave()).ok).toBe(true);
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(new MySqlDialect().sqlToQuery(lookups[0] as SQL).params).toEqual([STUDENT, "A"]);
    expect(trySyncSheet).toHaveBeenCalledWith("responses", "A");
  });
});

describe("finalizeSubmission", () => {
  afterEach(() => {
    vi.mocked(workingTermId).mockImplementation(async () => "test-term");
  });

  // A Shift Lead's finish reads their closes. Every read and the sheet sync
  // must stay in the term the gate resolved, even if a semester starts mid-way.
  it("checks a Shift Lead's closes and syncs the sheet in the gate's term only", async () => {
    const answers = ["A", "B"];
    vi.mocked(workingTermId).mockImplementation(async () => answers.shift() ?? "test-term");
    vi.mocked(requireEditableStudent).mockImplementation(async () => ({
      ok: true,
      email: STUDENT,
      positionId: "sl",
      onBehalf: false,
      termId: await workingTermId(),
    }));
    const block = { id: "b1", positionId: "sl", dayType: "weekday" as const, start: 480, end: 840 };
    vi.mocked(loadPositionWithBlocks).mockResolvedValue({ position: POSITION, blocks: [block] });
    vi.mocked(loadCloseRequirement).mockResolvedValue({ required: 3, assigned: true });
    vi.mocked(countCloseClaims).mockResolvedValue(3);

    const lookups: unknown[] = [];
    const db = {
      select: () => {
        let table = "";
        const chain = {
          from(t: unknown) {
            table = getTableName(t as Table);
            return chain;
          },
          where(clause: unknown) {
            if (table === "submissions") lookups.push(clause);
            return chain;
          },
          limit: async () =>
            table === "submissions"
              ? [
                  {
                    id: "sub-1",
                    everyWeekendOptIn: false,
                    desiredHours: 15,
                    courseScheduleFileId: "file-1",
                    submittedAt: null,
                  },
                ]
              : [],
          then: (resolve: (rows: unknown[]) => unknown) =>
            resolve(
              table === "shift_selections"
                ? [
                    { blockId: "b1", day: "mon" },
                    { blockId: "b1", day: "tue" },
                  ]
                : [],
            ),
        };
        return chain;
      },
      insert: () => ({ values: async () => {} }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
      delete: () => ({ where: async () => {} }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    expect(await finalizeSubmission()).toMatchObject({ ok: true });
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(new MySqlDialect().sqlToQuery(lookups[0] as SQL).params).toEqual([STUDENT, "A"]);
    expect(loadCloseRequirement).toHaveBeenCalledWith(STUDENT, "sl", "A");
    expect(countCloseClaims).toHaveBeenCalledWith(STUDENT, "A");
    expect(trySyncSheet).toHaveBeenCalledWith("responses", "A");
  });
});
