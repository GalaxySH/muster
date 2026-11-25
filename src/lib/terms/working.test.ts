import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";

// The real resolver: every other test file gets the mock from vitest.setup.ts.
vi.unmock("@/lib/terms/working");
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));

import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { getAppSession } from "@/lib/auth/session";
import { TERM_COOKIE, workingTermId } from "./working";

/** The pointer names spring. `terms` answers for the ids in `known`. */
function database(known: string[]) {
  const db = {
    select: () => {
      let table = "";
      const chain = {
        from(t: unknown) {
          table = getTableName(t as Table);
          return chain;
        },
        innerJoin: () => chain,
        where: () => chain,
        limit: () =>
          Promise.resolve(
            table === "app_settings" ? [{ id: "2027-spring" }] : known.map((id) => ({ id })),
          ),
      };
      return chain;
    },
  };
  vi.mocked(getDb).mockReturnValue(db as never);
}

function request(cookie: string | null, isAdmin: boolean | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (cookie && name === TERM_COOKIE ? { value: cookie } : undefined),
  } as never);
  vi.mocked(getAppSession).mockResolvedValue(
    isAdmin === null ? null : { email: "x@wisc.edu", name: null, isAdmin, method: "google" },
  );
}

describe("workingTermId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database(["2026-fall"]);
  });

  it("is the current term with no selection, without looking at the session", async () => {
    request(null, false);
    await expect(workingTermId()).resolves.toBe("2027-spring");
    expect(getAppSession).not.toHaveBeenCalled();
  });

  it("is the term an admin selected", async () => {
    request("2026-fall", true);
    await expect(workingTermId()).resolves.toBe("2026-fall");
  });

  // The cookie is only a request. A student can send any value they like.
  it("stays the current term for a student who sends a selection", async () => {
    request("2026-fall", false);
    await expect(workingTermId()).resolves.toBe("2027-spring");
  });

  it("stays the current term for a signed-out request that sends one", async () => {
    request("2026-fall", null);
    await expect(workingTermId()).resolves.toBe("2027-spring");
  });

  it("ignores a selection naming a term that is gone", async () => {
    database([]);
    request("2025-fall", true);
    await expect(workingTermId()).resolves.toBe("2027-spring");
  });

  // The digest scheduler and the scripts run with no request behind them.
  it("is the current term where there are no cookies to read", async () => {
    vi.mocked(cookies).mockRejectedValue(new Error("cookies was called outside a request scope"));
    await expect(workingTermId()).resolves.toBe("2027-spring");
  });
});
