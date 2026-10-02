import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/sheet-sync", () => ({ SCHEDULE_SHEET: "schedule", trySyncSheet: vi.fn() }));
vi.mock("./data", () => ({ loadCurrentRunRow: vi.fn() }));

import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { onRosterStudent } from "@/lib/roster/lookup";
import { applyScheduleEdits } from "./manual";
import { loadCurrentRunRow } from "./data";

describe("applyScheduleEdits", () => {
  it("refuses to place an off-roster student before changing assignments", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "admin@wisc.edu" });
    vi.mocked(loadCurrentRunRow).mockResolvedValue({ id: "run-1" } as never);

    let rosterWhere = "";
    interface Query {
      leftJoin(): Query;
      where(clause: SQL): Query;
      limit(): Promise<unknown[]>;
    }
    const query: Query = {
      leftJoin: () => query,
      where: (clause: SQL) => {
        rosterWhere = new MySqlDialect().sqlToQuery(clause).sql;
        return query;
      },
      limit: async () => [],
    };
    const transaction = vi.fn();
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => query }),
      transaction,
    } as never);

    const result = await applyScheduleEdits(
      "left@wisc.edu",
      [],
      [{ blockId: "shift-1", day: "mon" }],
    );

    expect(result).toEqual({
      ok: false,
      error: "This student is no longer on the roster and cannot be scheduled.",
    });
    expect(rosterWhere).toContain(new MySqlDialect().sqlToQuery(onRosterStudent()).sql);
    expect(transaction).not.toHaveBeenCalled();
  });
});
