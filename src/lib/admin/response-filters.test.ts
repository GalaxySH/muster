import { describe, it, expect } from "vitest";
import {
  parseResponseFilters,
  applyResponseFilters,
  serializeResponseFilters,
  FLAG_FILTER_OPTIONS,
  type ResponseFilters,
} from "./response-filters";
import type { DbFlagType } from "@/lib/db/schema";

type Row = {
  email: string;
  groupId: string | null;
  flagTypes: DbFlagType[];
  onRoster: boolean;
  hiredOn: Date | null;
};

const rows: Row[] = [
  { email: "a@wisc.edu", groupId: "g1", flagTypes: [], onRoster: true, hiredOn: iso("2025-08-20") },
  {
    email: "b@wisc.edu",
    groupId: "g1",
    flagTypes: ["auto_assigned_weekend"],
    onRoster: true,
    hiredOn: iso("2026-01-15"),
  },
  {
    email: "c@wisc.edu",
    groupId: "g2",
    flagTypes: ["travel_late"],
    onRoster: true,
    hiredOn: iso("2026-06-01"),
  },
  {
    email: "d@wisc.edu",
    groupId: null,
    flagTypes: ["auto_assigned_weekend", "travel_late"],
    onRoster: true,
    hiredOn: null,
  },
  {
    email: "e@wisc.edu",
    groupId: "g2",
    flagTypes: ["position_change", "revalidation_failed"],
    onRoster: true,
    hiredOn: iso("2026-01-15"),
  },
  { email: "f@wisc.edu", groupId: null, flagTypes: [], onRoster: false, hiredOn: iso("2024-09-03") },
];

function iso(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

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

  it("reads the off-roster switch and rejects other roster values", () => {
    expect(parseResponseFilters({ roster: "all" })).toEqual({ includeOffRoster: true });
    expect(parseResponseFilters({ roster: "bogus" })).toEqual({});
    expect(parseResponseFilters({ roster: "" })).toEqual({});
  });

  it("reads a start-date filter when both mode and date are valid", () => {
    expect(parseResponseFilters({ started: "before", startedDate: "2026-01-15" })).toEqual({
      started: { mode: "before", date: "2026-01-15" },
    });
    expect(parseResponseFilters({ started: "after", startedDate: "2026-01-15" })).toEqual({
      started: { mode: "after", date: "2026-01-15" },
    });
    expect(parseResponseFilters({ started: "on", startedDate: "2026-01-15" })).toEqual({
      started: { mode: "on", date: "2026-01-15" },
    });
  });

  it("drops a start-date filter missing either half or malformed", () => {
    expect(parseResponseFilters({ started: "before" })).toEqual({});
    expect(parseResponseFilters({ startedDate: "2026-01-15" })).toEqual({});
    expect(parseResponseFilters({ started: "bogus", startedDate: "2026-01-15" })).toEqual({});
    expect(parseResponseFilters({ started: "on", startedDate: "not-a-date" })).toEqual({});
    expect(parseResponseFilters({ started: "on", startedDate: "2026-13-45" })).toEqual({});
  });
});

describe("applyResponseFilters", () => {
  it("returns only on-roster rows when no filter is set", () => {
    expect(emails(applyResponseFilters(rows, {}))).toEqual(
      ["a", "b", "c", "d", "e"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("includes off-roster rows when the switch is on", () => {
    expect(emails(applyResponseFilters(rows, { includeOffRoster: true }))).toEqual(
      ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("combines the off-roster switch with other filters", () => {
    expect(emails(applyResponseFilters(rows, { includeOffRoster: true, groupId: "none" }))).toEqual([
      "d@wisc.edu",
      "f@wisc.edu",
    ]);
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

  it("filters to responders who started before a date (exclusive)", () => {
    expect(
      emails(applyResponseFilters(rows, { started: { mode: "before", date: "2026-01-15" } })),
    ).toEqual(["a@wisc.edu"]);
  });

  it("filters to responders who started after a date (exclusive)", () => {
    expect(
      emails(applyResponseFilters(rows, { started: { mode: "after", date: "2026-01-15" } })),
    ).toEqual(["c@wisc.edu"]);
  });

  it("filters to responders who started on a date", () => {
    expect(
      emails(applyResponseFilters(rows, { started: { mode: "on", date: "2026-01-15" } })),
    ).toEqual(["b@wisc.edu", "e@wisc.edu"]);
  });

  it("never matches rows with no recorded start date", () => {
    const before = applyResponseFilters(rows, { started: { mode: "before", date: "2099-01-01" } });
    expect(emails(before)).not.toContain("d@wisc.edu");
  });

  it("combines the start-date filter with the off-roster switch", () => {
    expect(
      emails(
        applyResponseFilters(rows, {
          started: { mode: "before", date: "2025-01-01" },
          includeOffRoster: true,
        }),
      ),
    ).toEqual(["f@wisc.edu"]);
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
    const f: ResponseFilters = {
      groupId: "g2",
      flag: "travel_late",
      includeOffRoster: true,
      started: { mode: "on", date: "2026-01-15" },
    };
    const qs = serializeResponseFilters(f);
    expect(qs).toBe("group=g2&flag=travel_late&roster=all&started=on&startedDate=2026-01-15");
    expect(parseResponseFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(f);
  });
});
