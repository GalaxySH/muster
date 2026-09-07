import { describe, it, expect } from "vitest";
import {
  DEFAULT_SORT,
  compareResponses,
  joinQuery,
  parseResponseSort,
  serializeResponseSort,
  sortResponses,
  type SortableResponse,
} from "./response-sort";

const row = (over: Partial<SortableResponse> & { displayName: string }): SortableResponse => ({
  groupName: "Returners",
  positionName: "Cashier",
  status: "submitted",
  desiredHours: 10,
  flagCount: 0,
  scheduled: false,
  submittedAt: null,
  updatedAt: null,
  ...over,
});

const names = (rows: SortableResponse[]) => rows.map((r) => r.displayName);

describe("parseResponseSort", () => {
  it("falls back to name ascending when nothing is set", () => {
    expect(parseResponseSort({})).toEqual(DEFAULT_SORT);
  });

  it("reads a key and direction", () => {
    expect(parseResponseSort({ sort: "flags", dir: "desc" })).toEqual({ key: "flags", dir: -1 });
  });

  it("drops an unknown key rather than sorting by nothing", () => {
    expect(parseResponseSort({ sort: "haircolour" }).key).toBe("name");
  });

  it("keeps the direction even on the default key", () => {
    // "name, reversed" is a real choice and has to survive the round trip.
    expect(parseResponseSort({ sort: "name", dir: "desc" })).toEqual({ key: "name", dir: -1 });
  });
});

describe("serializeResponseSort", () => {
  it("writes nothing while the sort is the default", () => {
    expect(serializeResponseSort(DEFAULT_SORT)).toBe("");
  });

  it("round-trips every non-default sort", () => {
    for (const key of ["group", "position", "flags", "updated", "name"] as const) {
      for (const dir of [1, -1] as const) {
        const sort = { key, dir };
        if (key === "name" && dir === 1) continue;
        expect(
          parseResponseSort(Object.fromEntries(new URLSearchParams(serializeResponseSort(sort)))),
        ).toEqual(sort);
      }
    }
  });
});

describe("joinQuery", () => {
  it("joins what is there and drops what is not", () => {
    expect(joinQuery("group=a", "sort=flags")).toBe("group=a&sort=flags");
    expect(joinQuery("", "sort=flags")).toBe("sort=flags");
    expect(joinQuery("group=a", "")).toBe("group=a");
    expect(joinQuery("", "")).toBe("");
  });
});

describe("sortResponses", () => {
  const rows = [
    row({ displayName: "Cyd", flagCount: 1 }),
    row({ displayName: "Amy", flagCount: 3 }),
    row({ displayName: "Boyd", flagCount: 1 }),
  ];

  it("sorts by the key, ascending and descending", () => {
    expect(names(sortResponses(rows, { key: "flags", dir: 1 }))).toEqual(["Boyd", "Cyd", "Amy"]);
    expect(names(sortResponses(rows, { key: "flags", dir: -1 }))).toEqual(["Amy", "Boyd", "Cyd"]);
  });

  it("breaks ties on name so the order is total", () => {
    // Boyd and Cyd both have one flag. Without the tiebreak their order would
    // depend on the input order, and the per-student walk would disagree with
    // the table about which row comes next.
    const reversed = [...rows].reverse();
    expect(names(sortResponses(rows, { key: "flags", dir: 1 }))).toEqual(
      names(sortResponses(reversed, { key: "flags", dir: 1 })),
    );
  });

  it("does not mutate the caller's array", () => {
    const before = names(rows);
    sortResponses(rows, { key: "flags", dir: -1 });
    expect(names(rows)).toEqual(before);
  });

  it("puts students with no submission first when sorting by last activity", () => {
    const dated = [
      row({ displayName: "Amy", submittedAt: new Date("2026-08-02T00:00:00Z") }),
      row({ displayName: "Boyd" }),
      row({ displayName: "Cyd", updatedAt: new Date("2026-08-01T00:00:00Z") }),
    ];
    expect(names(sortResponses(dated, { key: "updated", dir: 1 }))).toEqual(["Boyd", "Cyd", "Amy"]);
  });
});

describe("compareResponses", () => {
  it("reads submittedAt in preference to updatedAt", () => {
    const submitted = row({
      displayName: "Amy",
      submittedAt: new Date("2026-08-05T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const edited = row({ displayName: "Boyd", updatedAt: new Date("2026-08-04T00:00:00Z") });
    expect(compareResponses(submitted, edited, "updated")).toBeGreaterThan(0);
  });

  it("treats a missing desired-hours as zero rather than throwing", () => {
    const none = row({ displayName: "Amy", desiredHours: null });
    const some = row({ displayName: "Boyd", desiredHours: 12 });
    expect(compareResponses(none, some, "requested")).toBeLessThan(0);
  });

  it("sorts ungrouped students after every named group", () => {
    const grouped = row({ displayName: "Amy", groupName: "Returners" });
    const ungrouped = row({ displayName: "Boyd", groupName: null });
    expect(compareResponses(grouped, ungrouped, "group")).toBeLessThan(0);
  });

  it("orders named groups alphabetically", () => {
    const a = row({ displayName: "Amy", groupName: "Everyone else" });
    const b = row({ displayName: "Boyd", groupName: "Returners" });
    expect(compareResponses(a, b, "group")).toBeLessThan(0);
  });
});
