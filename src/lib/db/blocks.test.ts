import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { isLiveBlock, liveBlocksOnly } from "./blocks";

describe("liveBlocksOnly", () => {
  it("filters on shift_blocks.retired_at being null", () => {
    const query = new MySqlDialect().sqlToQuery(liveBlocksOnly());
    expect(query.sql).toBe("`shift_blocks`.`retired_at` is null");
    expect(query.params).toEqual([]);
  });
});

describe("isLiveBlock", () => {
  it("is true only for a block that was never retired", () => {
    expect(isLiveBlock({ retiredAt: null })).toBe(true);
    expect(isLiveBlock({ retiredAt: new Date("2026-01-02T03:04:05Z") })).toBe(false);
  });
});
