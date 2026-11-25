import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module: the admin gate, the DB handle, the
// settings row and the membership writes are all I/O. Stub them so the two
// whole-term actions can be exercised in node.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/auth/require-admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/require-admin")>();
  const requireAdmin = vi.fn();
  // The admin check is stubbed, the semester check is the real one, against
  // the "test-term" vitest.setup.ts answers as the working term.
  const requireAdminIn = async (termId: string) => {
    const gate = await requireAdmin();
    if (!gate.ok || (await real.isWorkingTerm(termId))) return gate;
    return { ok: false, error: real.STALE_TERM_MESSAGE };
  };
  return { ...real, requireAdmin, requireAdminIn };
});
vi.mock("@/lib/settings", () => ({
  setSetting: vi.fn(),
  SETTING_DEFAULT_GROUP_AUTO_ASSIGN: "default_group_auto_assign",
}));
vi.mock("./data", () => ({
  getDefaultAutoAssignEnabled: vi.fn(),
  getDefaultGroup: vi.fn(),
  listStudentsForPicker: vi.fn(),
}));
vi.mock("./membership", () => ({
  assignMembers: vi.fn(),
  listUnsweptEmails: vi.fn(),
  unassignMembers: vi.fn(),
}));

import { getTableName, type Table } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireAdmin, STALE_TERM_MESSAGE } from "@/lib/auth/require-admin";
import { getDefaultAutoAssignEnabled, getDefaultGroup } from "./data";
import { assignMembers, listUnsweptEmails } from "./membership";
import { createGroup, runDefaultAssignmentSweep } from "./actions";

/** Stand-in for the drizzle handle: logs each insert and the values it carried. */
function useDb() {
  const inserted: { table: string; values: unknown }[] = [];
  const db = {
    insert: (t: unknown) => ({
      values: async (values: unknown) => {
        inserted.push({ table: getTableName(t as Table), values });
      },
    }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return inserted;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "boss@wisc.edu" });
  vi.mocked(getDefaultAutoAssignEnabled).mockResolvedValue(true);
  vi.mocked(getDefaultGroup).mockResolvedValue({ id: "g1" } as never);
  vi.mocked(listUnsweptEmails).mockResolvedValue(["a@wisc.edu", "b@wisc.edu"]);
});

describe("createGroup", () => {
  it("refuses a page rendered for another semester without touching the database", async () => {
    expect(await createGroup("2026-fall", "Late hires")).toEqual({
      ok: false,
      error: STALE_TERM_MESSAGE,
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("creates the group in the page's own semester", async () => {
    const inserted = useDb();
    expect(await createGroup("test-term", " Late hires ")).toEqual({ ok: true });
    expect(inserted).toEqual([
      {
        table: "groups",
        values: expect.objectContaining({ termId: "test-term", name: "Late hires" }),
      },
    ]);
  });
});

describe("runDefaultAssignmentSweep", () => {
  it("refuses a page rendered for another semester and assigns nobody", async () => {
    expect(await runDefaultAssignmentSweep("2026-fall")).toEqual({
      ok: false,
      error: STALE_TERM_MESSAGE,
      enabled: false,
      swept: 0,
    });
    expect(listUnsweptEmails).not.toHaveBeenCalled();
    expect(assignMembers).not.toHaveBeenCalled();
  });

  it("sweeps the page's own semester", async () => {
    useDb();
    expect(await runDefaultAssignmentSweep("test-term")).toEqual({
      ok: true,
      enabled: true,
      swept: 2,
    });
    expect(listUnsweptEmails).toHaveBeenCalledWith(expect.anything(), "test-term");
    expect(assignMembers).toHaveBeenCalledWith(
      expect.anything(),
      "test-term",
      ["a@wisc.edu", "b@wisc.edu"],
      "g1",
      true,
    );
  });
});
