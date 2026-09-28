import { beforeEach, describe, expect, it, vi } from "vitest";

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
  isCloseStepRequired: vi.fn(),
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
import { loadPositionWithBlocks } from "./data";
import { saveDesiredHoursFor, saveStudentNotesFor } from "./actions";

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
  });
  vi.mocked(ensureSubmissionId).mockResolvedValue("new-sub");
  vi.mocked(loadPositionWithBlocks).mockResolvedValue({ position: POSITION, blocks: [] });
});

describe("saveDesiredHoursFor", () => {
  it("overwrites the student's answer without moving updated_at", async () => {
    const updates = useDb([{ id: "sub-1", status: "submitted" }]);

    expect(await saveDesiredHoursFor(STUDENT, 15)).toEqual({ ok: true });
    expect(requireEditableStudent).toHaveBeenCalledWith(STUDENT);
    expect(updates).toEqual([{ desiredHours: 15 }]);
    // It is one of the revalidation checks, and a submitted row is in the sheet.
    expect(syncRevalidationFlag).toHaveBeenCalledWith(expect.anything(), "sub-1");
    expect(trySyncSheet).toHaveBeenCalled();
  });

  it("refuses anything under the position floor, as the form does", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    const res = await saveDesiredHoursFor(STUDENT, 9);
    expect(res).toEqual({ ok: false, error: "Must be at least 10h." });
    expect(updates).toEqual([]);
  });

  it("refuses a fraction of an hour", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    expect((await saveDesiredHoursFor(STUDENT, 12.5)).ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("clears the answer on null", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    expect(await saveDesiredHoursFor(STUDENT, null)).toEqual({ ok: true });
    expect(updates).toEqual([{ desiredHours: null }]);
    expect(trySyncSheet).not.toHaveBeenCalled();
  });

  it("starts a stub for a student with no submission, with nothing to revalidate", async () => {
    const updates = useDb([]);
    expect(await saveDesiredHoursFor(STUDENT, 12)).toEqual({ ok: true });
    expect(ensureSubmissionId).toHaveBeenCalledWith(STUDENT);
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
    expect((await saveDesiredHoursFor(STUDENT, 12)).ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("never falls back to the caller's own form on a blank student", async () => {
    useDb([]);
    expect((await saveDesiredHoursFor("  ", 12)).ok).toBe(false);
    expect(requireEditableStudent).not.toHaveBeenCalled();
  });
});

describe("saveStudentNotesFor", () => {
  it("trims the note and leaves updated_at alone", async () => {
    const updates = useDb([{ id: "sub-1", status: "submitted" }]);
    expect(await saveStudentNotesFor(STUDENT, "  Mornings only \n")).toEqual({ ok: true });
    expect(updates).toEqual([{ studentNotes: "Mornings only" }]);
    expect(syncRevalidationFlag).not.toHaveBeenCalled();
    expect(trySyncSheet).toHaveBeenCalled();
  });

  it("stores an emptied note as null", async () => {
    const updates = useDb([{ id: "sub-1", status: "draft" }]);
    await saveStudentNotesFor(STUDENT, "   ");
    expect(updates).toEqual([{ studentNotes: null }]);
  });

  it("never falls back to the caller's own form on a blank student", async () => {
    useDb([]);
    expect((await saveStudentNotesFor("", "hi")).ok).toBe(false);
    expect(requireEditableStudent).not.toHaveBeenCalled();
  });
});
