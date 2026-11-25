import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin assign names a lead by email, and the same lead is in every term,
// so it takes the term its page was rendered for. The real gate runs here
// against a stubbed session; vitest.setup.ts answers "test-term" as the
// working term.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/roster/lookup", () => ({ findStudentByEmail: vi.fn() }));
vi.mock("./requirements", () => ({ ensureCloseRequirements: vi.fn() }));
vi.mock("./claim-write", () => ({ insertCloseClaim: vi.fn() }));
vi.mock("./data", () => ({ positionPicksCloses: vi.fn() }));
// Held here rather than imported: the sheet sync is console code.
const { trySyncSheet } = vi.hoisted(() => ({ trySyncSheet: vi.fn() }));
vi.mock("@/lib/admin/sheet-sync", () => ({
  trySyncSheet,
  syncSheet: vi.fn(),
  CLOSES_SHEET: "closes",
  SHEET_MANUAL_COOLDOWN_MS: 30_000,
}));

import { getAppSession } from "@/lib/auth/session";
import { STALE_TERM_MESSAGE } from "@/lib/auth/require-admin";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { workingTermId } from "@/lib/terms/working";
import { insertCloseClaim } from "./claim-write";
import { positionPicksCloses } from "./data";
import { assignCloseClaim } from "./admin-actions";

const LEAD = "lead@wisc.edu";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppSession).mockResolvedValue({
    email: "admin@wisc.edu",
    isAdmin: true,
  } as Awaited<ReturnType<typeof getAppSession>>);
  vi.mocked(findStudentByEmail).mockResolvedValue({
    email: LEAD,
    onRoster: true,
    positionId: "sl",
  } as Awaited<ReturnType<typeof findStudentByEmail>>);
  vi.mocked(positionPicksCloses).mockResolvedValue(true);
  vi.mocked(insertCloseClaim).mockResolvedValue(null);
});

describe("assignCloseClaim", () => {
  it("assigns in the term the page was rendered for", async () => {
    expect(await assignCloseClaim("slot-1", LEAD, "test-term")).toEqual({ ok: true });
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(findStudentByEmail).toHaveBeenCalledWith(LEAD, "test-term");
    expect(insertCloseClaim).toHaveBeenCalledWith("slot-1", LEAD, "test-term");
    expect(trySyncSheet).toHaveBeenCalledWith("closes", "test-term");
  });

  it("refuses a tab showing another term and writes nothing", async () => {
    expect(await assignCloseClaim("slot-1", LEAD, "other-term")).toEqual({
      ok: false,
      error: STALE_TERM_MESSAGE,
    });
    expect(findStudentByEmail).not.toHaveBeenCalled();
    expect(insertCloseClaim).not.toHaveBeenCalled();
    expect(trySyncSheet).not.toHaveBeenCalled();
  });
});
