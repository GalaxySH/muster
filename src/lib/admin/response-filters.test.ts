import { describe, it, expect } from "vitest";
import {
  parseResponseFilters,
  applyResponseFilters,
  serializeResponseFilters,
  FLAG_FILTER_OPTIONS,
  type ResponseFilters,
} from "./response-filters";
import type { DbFlagType } from "@/lib/db/schema";

type Row = { email: string; groupId: string | null; flagTypes: DbFlagType[] };

const rows: Row[] = [
  { email: "a@wisc.edu", groupId: "g1", flagTypes: [] },
  { email: "b@wisc.edu", groupId: "g1", flagTypes: ["auto_assigned_weekend"] },
  { email: "c@wisc.edu", groupId: "g2", flagTypes: ["travel_late"] },
  { email: "d@wisc.edu", groupId: null, flagTypes: ["auto_assigned_weekend", "travel_late"] },
  { email: "e@wisc.edu", groupId: "g2", flagTypes: ["position_change", "revalidation_failed"] },
];

const emails = (r: Row[]) => r.map((x) => x.email);

describe("parseResponseFilters", () => {
  it("returns an empty filter for no params", () => {
    expect(parseResponseFilters({})).toEqual({});
  });

  it("reads a group id", () => {
    expect(parseResponseFilters({ group: "g1" })).toEqual({ groupId: "g1" });
  });

  it("reads the 'none' (ungrouped) sentinel", () => {
    expect(parseResponseFilters({ group: "none" })).toEqual({ groupId: "none" });
  });

  it("ignores an 'all' / empty group value", () => {
    expect(parseResponseFilters({ group: "all" })).toEqual({});
    expect(parseResponseFilters({ group: "" })).toEqual({});
  });

  it("reads a known flag filter and rejects unknown ones", () => {
    expect(parseResponseFilters({ flag: "any" })).toEqual({ flag: "any" });
    expect(parseResponseFilters({ flag: "auto_assigned_weekend" })).toEqual({
      flag: "auto_assigned_weekend",
    });
    expect(parseResponseFilters({ flag: "position_change" })).toEqual({
      flag: "position_change",
    });
    expect(parseResponseFilters({ flag: "revalidation_failed" })).toEqual({
      flag: "revalidation_failed",
    });
    expect(parseResponseFilters({ flag: "bogus" })).toEqual({});
  });
});

describe("applyResponseFilters", () => {
  it("returns all rows when no filter is set", () => {
    expect(emails(applyResponseFilters(rows, {}))).toEqual(["a", "b", "c", "d", "e"].map((x) => `${x}@wisc.edu`));
  });

  it("filters to a specific group", () => {
    expect(emails(applyResponseFilters(rows, { groupId: "g1" }))).toEqual([
      "a@wisc.edu",
      "b@wisc.edu",
    ]);
  });

  it("filters to ungrouped responders", () => {
    expect(emails(applyResponseFilters(rows, { groupId: "none" }))).toEqual(["d@wisc.edu"]);
  });

  it("filters to any-flagged responders", () => {
    expect(emails(applyResponseFilters(rows, { flag: "any" }))).toEqual([
      "b@wisc.edu",
      "c@wisc.edu",
      "d@wisc.edu",
      "e@wisc.edu",
    ]);
  });

  it("filters to a specific flag type", () => {
    expect(emails(applyResponseFilters(rows, { flag: "auto_assigned_weekend" }))).toEqual([
      "b@wisc.edu",
      "d@wisc.edu",
    ]);
    expect(emails(applyResponseFilters(rows, { flag: "position_change" }))).toEqual([
      "e@wisc.edu",
    ]);
    expect(emails(applyResponseFilters(rows, { flag: "revalidation_failed" }))).toEqual([
      "e@wisc.edu",
    ]);
  });

  it("combines group and flag filters", () => {
    const f: ResponseFilters = { groupId: "g1", flag: "any" };
    expect(emails(applyResponseFilters(rows, f))).toEqual(["b@wisc.edu"]);
  });
});

describe("FLAG_FILTER_OPTIONS", () => {
  it("offers every flag type with its label", () => {
    expect(FLAG_FILTER_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: "auto_assigned_weekend", label: "Auto-assigned weekend" },
        { value: "travel_late", label: "Late travel" },
        { value: "position_change", label: "Position changed" },
        { value: "revalidation_failed", label: "Fails validation" },
      ]),
    );
  });
});

describe("serializeResponseFilters", () => {
  it("is empty for no filters", () => {
    expect(serializeResponseFilters({})).toBe("");
  });

  it("round-trips through parse", () => {
    const f: ResponseFilters = { groupId: "g2", flag: "travel_late" };
    const qs = serializeResponseFilters(f);
    expect(qs).toBe("group=g2&flag=travel_late");
    expect(parseResponseFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(f);
  });
});
