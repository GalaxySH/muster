import { describe, it, expect } from "vitest";
import {
  parseResponseFilters,
  applyResponseFilters,
  neighborFallbackFilters,
  serializeResponseFilters,
  FLAG_FILTER_OPTIONS,
  type ResponseFilters,
} from "./response-filters";
import type { DbFlagType } from "@/lib/db/schema";

type Row = {
  email: string;
  groupId: string | null;
  positionId: string | null;
  flagTypes: DbFlagType[];
  onRoster: boolean;
  hiredOn: Date | null;
  status: "draft" | "submitted" | "missing";
  scheduled: boolean;
};

const rows: Row[] = [
  {
    email: "a@wisc.edu",
    groupId: "g1",
    positionId: "p1",
    flagTypes: [],
    onRoster: true,
    hiredOn: iso("2025-08-20"),
    status: "submitted",
    scheduled: false,
  },
  {
    email: "b@wisc.edu",
    groupId: "g1",
    positionId: "p1",
    flagTypes: ["auto_assigned_weekend"],
    onRoster: true,
    hiredOn: iso("2026-01-15"),
    status: "submitted",
    scheduled: true,
  },
  {
    email: "c@wisc.edu",
    groupId: "g2",
    positionId: "p2",
    flagTypes: ["travel_late"],
    onRoster: true,
    hiredOn: iso("2026-06-01"),
    status: "draft",
    scheduled: false,
  },
  {
    email: "d@wisc.edu",
    groupId: null,
    positionId: null,
    flagTypes: ["auto_assigned_weekend", "travel_late"],
    onRoster: true,
    hiredOn: null,
    status: "submitted",
    scheduled: false,
  },
  {
    email: "e@wisc.edu",
    groupId: "g2",
    positionId: "p2",
    flagTypes: ["position_change", "revalidation_failed"],
    onRoster: true,
    hiredOn: iso("2026-01-15"),
    status: "submitted",
    scheduled: true,
  },
  {
    email: "f@wisc.edu",
    groupId: null,
    positionId: "p1",
    flagTypes: [],
    onRoster: false,
    hiredOn: iso("2024-09-03"),
    status: "submitted",
    scheduled: false,
  },
  // Roster students who never started a submission (only listed with `all`).
  {
    email: "g@wisc.edu",
    groupId: "g1",
    positionId: "p1",
    flagTypes: [],
    onRoster: true,
    hiredOn: iso("2026-01-15"),
    status: "missing",
    scheduled: false,
  },
  {
    email: "h@wisc.edu",
    groupId: null,
    positionId: null,
    flagTypes: [],
    onRoster: true,
    hiredOn: null,
    status: "missing",
    scheduled: false,
  },
];

/** A `date` column as the driver hands it back: midnight in the local zone. */
function iso(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
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

  it("reads a position id", () => {
    expect(parseResponseFilters({ position: "p1" })).toEqual({ positionId: "p1" });
  });

  it("reads the 'none' (no position) sentinel", () => {
    expect(parseResponseFilters({ position: "none" })).toEqual({ positionId: "none" });
  });

  it("ignores an 'all' / empty position value", () => {
    expect(parseResponseFilters({ position: "all" })).toEqual({});
    expect(parseResponseFilters({ position: "" })).toEqual({});
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

  it("reads every submission state and rejects unknown ones", () => {
    for (const status of ["submitted", "draft", "missing", "all"] as const) {
      expect(parseResponseFilters({ status })).toEqual({ status });
    }
    expect(parseResponseFilters({ status: "bogus" })).toEqual({});
    expect(parseResponseFilters({ status: "" })).toEqual({});
  });

  it("still reads the old all=1 link as everyone", () => {
    expect(parseResponseFilters({ all: "1" })).toEqual({ status: "all" });
    expect(parseResponseFilters({ all: "0" })).toEqual({});
    expect(parseResponseFilters({ all: "bogus" })).toEqual({});
    expect(parseResponseFilters({ all: "" })).toEqual({});
  });

  it("lets an explicit state win over the old switch", () => {
    expect(parseResponseFilters({ status: "draft", all: "1" })).toEqual({ status: "draft" });
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

  it("reads the review filter and rejects unknown values", () => {
    expect(parseResponseFilters({ review: "todo" })).toEqual({ review: "todo" });
    expect(parseResponseFilters({ review: "done" })).toEqual({ review: "done" });
    expect(parseResponseFilters({ review: "bogus" })).toEqual({});
  });
});

describe("the review filter", () => {
  it("shows submitted responses not yet marked scheduled", () => {
    // c is a draft, so it is nobody's to review however unscheduled it is.
    expect(emails(applyResponseFilters(rows, { review: "todo" }))).toEqual([
      "a@wisc.edu",
      "d@wisc.edu",
    ]);
  });

  it("shows the ones already marked scheduled", () => {
    expect(emails(applyResponseFilters(rows, { review: "done" }))).toEqual([
      "b@wisc.edu",
      "e@wisc.edu",
    ]);
  });

  it("never matches a draft on either side", () => {
    const todo = emails(applyResponseFilters(rows, { review: "todo" }));
    const done = emails(applyResponseFilters(rows, { review: "done" }));
    expect(todo).not.toContain("c@wisc.edu");
    expect(done).not.toContain("c@wisc.edu");
  });

  it("survives the query round-trip", () => {
    expect(serializeResponseFilters({ review: "todo" })).toBe("review=todo");
    expect(parseResponseFilters({ review: "todo" })).toEqual({ review: "todo" });
  });
});

describe("applyResponseFilters", () => {
  it("returns only on-roster responders when no filter is set", () => {
    expect(emails(applyResponseFilters(rows, {}))).toEqual(
      ["a", "b", "c", "d", "e"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("includes off-roster rows when the switch is on", () => {
    expect(emails(applyResponseFilters(rows, { includeOffRoster: true }))).toEqual(
      ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("includes students with no submission when the state is everyone", () => {
    expect(emails(applyResponseFilters(rows, { status: "all" }))).toEqual(
      ["a", "b", "c", "d", "e", "g", "h"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("combines everyone with the off-roster switch", () => {
    expect(emails(applyResponseFilters(rows, { status: "all", includeOffRoster: true }))).toEqual(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("combines everyone with other filters", () => {
    expect(emails(applyResponseFilters(rows, { status: "all", groupId: "g1" }))).toEqual([
      "a@wisc.edu",
      "b@wisc.edu",
      "g@wisc.edu",
    ]);
  });

  it("combines the off-roster switch with other filters", () => {
    expect(emails(applyResponseFilters(rows, { includeOffRoster: true, groupId: "none" }))).toEqual(
      ["d@wisc.edu", "f@wisc.edu"],
    );
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

  it("filters to a specific position", () => {
    expect(emails(applyResponseFilters(rows, { positionId: "p1" }))).toEqual([
      "a@wisc.edu",
      "b@wisc.edu",
    ]);
  });

  it("filters to responders with no position", () => {
    expect(emails(applyResponseFilters(rows, { positionId: "none" }))).toEqual(["d@wisc.edu"]);
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
    expect(emails(applyResponseFilters(rows, { flag: "position_change" }))).toEqual(["e@wisc.edu"]);
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
        { value: "revalidation_failed", label: "Failed validation" },
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
      positionId: "p2",
      flag: "travel_late",
      includeOffRoster: true,
      status: "all",
      started: { mode: "on", date: "2026-01-15" },
    };
    const qs = serializeResponseFilters(f);
    expect(qs).toBe(
      "group=g2&position=p2&flag=travel_late&roster=all&status=all&started=on&startedDate=2026-01-15",
    );
    expect(parseResponseFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(f);
  });

  it("round-trips every submission state and never writes the old param", () => {
    for (const status of ["submitted", "draft", "missing", "all"] as const) {
      const qs = serializeResponseFilters({ status });
      expect(qs).toBe(`status=${status}`);
      expect(parseResponseFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual({ status });
    }
  });

  it("writes nothing for the default view", () => {
    expect(serializeResponseFilters({ status: undefined })).toBe("");
  });
});

describe("the submission-state filter", () => {
  it("hides students with no submission by default, exactly as before", () => {
    // The pre-overhaul default was `includeMissing` absent, which is this.
    expect(emails(applyResponseFilters(rows, {}))).toEqual(
      ["a", "b", "c", "d", "e"].map((x) => `${x}@wisc.edu`),
    );
    expect(applyResponseFilters(rows, {})).toEqual(
      applyResponseFilters(rows, { status: undefined }),
    );
  });

  it("shows only submitted responses", () => {
    expect(emails(applyResponseFilters(rows, { status: "submitted" }))).toEqual(
      ["a", "b", "d", "e"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("shows only drafts", () => {
    expect(emails(applyResponseFilters(rows, { status: "draft" }))).toEqual(["c@wisc.edu"]);
  });

  it("shows only the students who never started one", () => {
    expect(emails(applyResponseFilters(rows, { status: "missing" }))).toEqual(
      ["g", "h"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("keeps the off-roster switch as its own toggle", () => {
    // f is off roster and submitted, so a submitted-only view still hides them.
    expect(emails(applyResponseFilters(rows, { status: "submitted" }))).not.toContain("f@wisc.edu");
    expect(
      emails(applyResponseFilters(rows, { status: "submitted", includeOffRoster: true })),
    ).toContain("f@wisc.edu");
  });

  it("composes with the review filter, which is unchanged", () => {
    expect(emails(applyResponseFilters(rows, { status: "submitted", review: "done" }))).toEqual(
      ["b", "e"].map((x) => `${x}@wisc.edu`),
    );
    // A draft matches neither side of review, so the two together find nobody.
    expect(applyResponseFilters(rows, { status: "draft", review: "todo" })).toEqual([]);
  });

  it("composes with the group and flag filters", () => {
    expect(emails(applyResponseFilters(rows, { status: "missing", groupId: "g1" }))).toEqual([
      "g@wisc.edu",
    ]);
    expect(emails(applyResponseFilters(rows, { status: "all", flag: "any" }))).toEqual(
      ["b", "c", "d", "e"].map((x) => `${x}@wisc.edu`),
    );
  });

  it("applies the old all=1 link the same way everyone does", () => {
    expect(applyResponseFilters(rows, parseResponseFilters({ all: "1" }))).toEqual(
      applyResponseFilters(rows, { status: "all" }),
    );
  });
});

describe("neighborFallbackFilters", () => {
  /**
   * What the per-student arrows do when the active filters hide the student on
   * screen: re-list with these filters, then walk the result.
   */
  const walk = (filters: ResponseFilters) =>
    emails(applyResponseFilters(rows, neighborFallbackFilters(filters)));

  it("keeps a chosen submission state, so the arrows stay inside it", () => {
    // Viewing g@wisc.edu under "No submission" walks g and h, not everyone.
    // Widening the state away here would march the arrows through a list the
    // dashboard never showed.
    expect(walk({ status: "missing" })).toEqual(["g@wisc.edu", "h@wisc.edu"]);
  });

  it("gives a student outside the chosen state no arrows, as the review filter does", () => {
    const list = applyResponseFilters(rows, neighborFallbackFilters({ status: "missing" }));
    expect(list.findIndex((r) => r.email === "a@wisc.edu")).toBe(-1);
  });

  it("widens to everyone only when no state was chosen", () => {
    // The default view hides students who never started a submission, but that
    // is a default rather than a choice, so one still walks with the rest.
    expect(neighborFallbackFilters({}).status).toBe("all");
    expect(walk({})).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => `${x}@wisc.edu`));
  });

  it("always opens the off-roster switch, which is only about visibility", () => {
    expect(neighborFallbackFilters({ status: "submitted" }).includeOffRoster).toBe(true);
    expect(walk({ status: "submitted" })).toContain("f@wisc.edu");
  });

  it("leaves every other filter exactly as it found it", () => {
    expect(neighborFallbackFilters({ status: "draft", groupId: "g2", review: "todo" })).toEqual({
      status: "draft",
      groupId: "g2",
      review: "todo",
      includeOffRoster: true,
    });
  });
});
