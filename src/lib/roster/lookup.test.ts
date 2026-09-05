import { describe, expect, it, vi } from "vitest";

// lookup.ts is a server module (it holds two DB reads), but the predicate under
// test is pure SQL construction, so the DB handle is never reached.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { MySqlDialect } from "drizzle-orm/mysql-core";
import { onRosterStudent } from "./lookup";

describe("onRosterStudent", () => {
  it("filters on students.on_roster being true", () => {
    const query = new MySqlDialect().sqlToQuery(onRosterStudent());
    expect(query.sql).toBe("`students`.`on_roster` = ?");
    expect(query.params).toEqual([true]);
  });
});
