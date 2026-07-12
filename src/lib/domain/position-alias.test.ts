import { describe, it, expect } from "vitest";
import { resolveAlias, canAliasTo, type AliasRow } from "./position-alias";

const row = (id: string, mergedIntoId: string | null = null): AliasRow => ({ id, mergedIntoId });

describe("resolveAlias", () => {
  it("resolves a canonical position to itself", () => {
    expect(resolveAlias("cashier", [row("cashier")])).toBe("cashier");
  });

  it("resolves an unknown id to itself", () => {
    expect(resolveAlias("mystery", [row("cashier")])).toBe("mystery");
  });

  it("follows a single alias link", () => {
    const rows = [row("cashier-flamingo", "cashier"), row("cashier")];
    expect(resolveAlias("cashier-flamingo", rows)).toBe("cashier");
  });

  it("follows a chain of alias links to the canonical id", () => {
    const rows = [row("a", "b"), row("b", "c"), row("c")];
    expect(resolveAlias("a", rows)).toBe("c");
  });

  it("stops at a link that points to a missing row", () => {
    const rows = [row("a", "gone")];
    expect(resolveAlias("a", rows)).toBe("gone");
  });

  it("terminates on a two-row cycle, returning the last sound id", () => {
    const rows = [row("a", "b"), row("b", "a")];
    expect(resolveAlias("a", rows)).toBe("b");
    expect(resolveAlias("b", rows)).toBe("a");
  });

  it("terminates on a self-cycle", () => {
    expect(resolveAlias("a", [row("a", "a")])).toBe("a");
  });

  it("terminates on a longer cycle entered mid-chain", () => {
    const rows = [row("a", "b"), row("b", "c"), row("c", "b")];
    expect(resolveAlias("a", rows)).toBe("c");
  });
});

describe("canAliasTo", () => {
  it("allows a canonical position as an alias target", () => {
    expect(canAliasTo(row("cashier"))).toBe(true);
  });

  it("refuses an alias as an alias target", () => {
    expect(canAliasTo(row("cashier-flamingo", "cashier"))).toBe(false);
  });
});
