import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module whose collaborators are all I/O (the
// student gate, the locking claim insert, the board read, the sheet sync).
// Stub them so the term each one is handed can be checked in node.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/groups/gate", () => ({ requireEditableStudent: vi.fn() }));
vi.mock("./claim-write", () => ({ insertCloseClaim: vi.fn() }));
vi.mock("./data", () => ({ loadCloseBoard: vi.fn(), positionPicksCloses: vi.fn() }));
// Held here rather than imported: the sheet sync is console code, and this
// folder may not import it (only actions.ts has that edge, on the allowlist).
const { trySyncSheet } = vi.hoisted(() => ({ trySyncSheet: vi.fn() }));
vi.mock("@/lib/admin/sheet-sync", () => ({ trySyncSheet, CLOSES_SHEET: "closes" }));

import { requireEditableStudent } from "@/lib/groups/gate";
import { workingTermId } from "@/lib/terms/working";
import { insertCloseClaim } from "./claim-write";
import { loadCloseBoard, positionPicksCloses } from "./data";
import { claimCloseSlot } from "./actions";

const LEAD = "lead@wisc.edu";
const BOARD = { slots: [], myClaimCount: 1, required: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  // The working term reads "A" and then "B", as if a semester started while
  // the claim ran. The gate stands in for the real one: it resolves the term
  // once and hands it back, and the action may use nothing else.
  let calls = 0;
  vi.mocked(workingTermId).mockImplementation(async () => (calls++ === 0 ? "A" : "B"));
  vi.mocked(requireEditableStudent).mockImplementation(async () => ({
    ok: true,
    email: LEAD,
    positionId: "sl",
    onBehalf: false,
    termId: await workingTermId(),
  }));
  vi.mocked(positionPicksCloses).mockResolvedValue(true);
  vi.mocked(loadCloseBoard).mockResolvedValue(BOARD);
});

describe("claimCloseSlot", () => {
  it("claims, syncs the sheet and reloads the board in the gate's term only", async () => {
    vi.mocked(insertCloseClaim).mockResolvedValue(null);

    expect(await claimCloseSlot("slot-1")).toEqual({ ok: true, board: BOARD });
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(insertCloseClaim).toHaveBeenCalledWith("slot-1", LEAD, "A");
    expect(trySyncSheet).toHaveBeenCalledWith("closes", "A");
    expect(loadCloseBoard).toHaveBeenCalledWith(LEAD, "A");
  });

  it("reloads the same term's board after a lost race", async () => {
    vi.mocked(insertCloseClaim).mockResolvedValue("slot-full");

    expect(await claimCloseSlot("slot-1")).toEqual({
      ok: false,
      error: "That shift just filled up. Pick another one.",
      board: BOARD,
    });
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(trySyncSheet).not.toHaveBeenCalled();
    expect(loadCloseBoard).toHaveBeenCalledWith(LEAD, "A");
  });
});
