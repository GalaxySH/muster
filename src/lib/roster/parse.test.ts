import { describe, it, expect } from "vitest";
import {
  parseRoster,
  parseLeaving,
  parseHireDate,
  reconcileLeaving,
  reconcileAdmins,
  type RawRosterRow,
  type RawLeavingRow,
} from "./parse";

const row = (over: Partial<RawRosterRow>): RawRosterRow => ({
  name: "Test Person",
  positionTitle: "Culinary Assistant",
  email: "test1@wisc.edu",
  international: "No",
  hireDate: "",
  ...over,
});

// Injected title map mirroring the seeded fixture (the importer builds the
// real one from roster_title_mappings via buildEffectiveTitleMap).
const TITLE_MAP: ReadonlyMap<string, string> = new Map([
  ["culinary assistant", "culinary-assistant"],
  ["student shift lead", "shift-lead"],
  ["dishwasher", "dishwasher"],
  ["student stocker", "stocker"],
  ["cashier", "cashier"],
  ["cashier (culinary assistant in sea)", "cashier"],
  ["southeast cafe team member", "barista"],
]);

// Injected excluded-title set mirroring the SKIP_TITLES fixture (the importer
// builds the real one from app_settings via effectiveExcludedTitles).
const EXCLUDED: ReadonlySet<string> = new Set(["dining advisor board member (dab)"]);

describe("parseRoster", () => {
  it("maps known titles to Muster positions and parses international", () => {
    const { students } = parseRoster(
      [
        row({ email: "ca1@wisc.edu", positionTitle: "Culinary Assistant", international: "Yes" }),
        row({ email: "sl1@wisc.edu", positionTitle: "Student Shift Lead" }),
        row({ email: "st1@wisc.edu", positionTitle: "Student Stocker" }),
      ],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students).toEqual([
      {
        email: "ca1@wisc.edu",
        displayName: "Test Person",
        positionId: "culinary-assistant",
        international: true,
        hiredOn: null,
        rosterTitle: "Culinary Assistant",
      },
      {
        email: "sl1@wisc.edu",
        displayName: "Test Person",
        positionId: "shift-lead",
        international: false,
        hiredOn: null,
        rosterTitle: "Student Shift Lead",
      },
      {
        email: "st1@wisc.edu",
        displayName: "Test Person",
        positionId: "stocker",
        international: false,
        hiredOn: null,
        rosterTitle: "Student Stocker",
      },
    ]);
  });

  it("maps Southeast Cafe Team Member to barista", () => {
    const { students } = parseRoster(
      [row({ positionTitle: "Southeast Cafe Team Member" })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students[0]?.positionId).toBe("barista");
  });

  it("classifies supervisor titles as admins, not students", () => {
    const { admins, students } = parseRoster(
      [
        row({ email: "boss@wisc.edu", positionTitle: "Office Student Supervisor" }),
        row({ email: "head@wisc.edu", positionTitle: "Head Student Supervisor" }),
      ],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students).toHaveLength(0);
    expect(admins.map((a) => a.email)).toEqual(["boss@wisc.edu", "head@wisc.edu"]);
  });

  it("skips rows whose title is in the injected excluded set (neither student nor admin)", () => {
    const r = parseRoster(
      [row({ positionTitle: "Dining Advisor Board Member (DAB)" })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(r.students).toHaveLength(0);
    expect(r.admins).toHaveLength(0);
    expect(r.skipped[0]?.reason).toBe("excluded_title");
  });

  it("imports a formerly excluded title once it leaves the set", () => {
    const r = parseRoster(
      [row({ positionTitle: "Dining Advisor Board Member (DAB)" })],
      TITLE_MAP,
      new Set(),
    );
    expect(r.skipped).toHaveLength(0);
    expect(r.students).toHaveLength(1);
    expect(r.students[0]?.positionId).toBeNull();
  });

  it("normalizes email case/whitespace and title casing, keeping the raw trimmed title", () => {
    const { students } = parseRoster(
      [row({ email: "  Stu@WISC.edu ", positionTitle: "  CULINARY   assistant " })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students[0]?.email).toBe("stu@wisc.edu");
    expect(students[0]?.positionId).toBe("culinary-assistant");
    expect(students[0]?.rosterTitle).toBe("CULINARY   assistant");
  });

  it("imports unknown titles as students with no position and reports them", () => {
    const { students, unmappedTitles } = parseRoster(
      [row({ positionTitle: "Mystery Role" }), row({ positionTitle: "Mystery Role" })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students).toHaveLength(2);
    expect(students[0]?.positionId).toBeNull();
    expect(students[0]?.rosterTitle).toBe("Mystery Role");
    expect(unmappedTitles.get("mystery role")).toBe(2);
  });

  it("maps titles only through the injected map", () => {
    const { students, unmappedTitles } = parseRoster([row({})], new Map(), EXCLUDED);
    expect(students[0]?.positionId).toBeNull();
    expect(unmappedTitles.get("culinary assistant")).toBe(1);
  });

  it("skips rows with missing or non-wisc emails", () => {
    const { students, skipped } = parseRoster(
      [row({ email: "" }), row({ email: "someone@gmail.com" })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["missing_email", "non_wisc_email"]);
  });

  it("carries a parsed hire date onto the student", () => {
    const { students } = parseRoster([row({ hireDate: "2025-08-20" })], TITLE_MAP, EXCLUDED);
    expect(students[0]?.hiredOn?.toISOString()).toBe("2025-08-20T00:00:00.000Z");
  });
});

describe("parseHireDate", () => {
  it("parses a yyyy-mm-dd string to UTC midnight", () => {
    expect(parseHireDate("2025-08-20")?.toISOString()).toBe("2025-08-20T00:00:00.000Z");
  });

  it("accepts an ISO datetime prefix", () => {
    expect(parseHireDate("2025-08-20T00:00:00.000Z")?.toISOString()).toBe(
      "2025-08-20T00:00:00.000Z",
    );
  });

  it("returns null for blank or unrecognized values", () => {
    expect(parseHireDate("")).toBeNull();
    expect(parseHireDate("not a date")).toBeNull();
  });
});

const leaving = (over: Partial<RawLeavingRow>): RawLeavingRow => ({
  name: "Gone Person",
  email: "gone1@wisc.edu",
  ...over,
});

describe("parseLeaving", () => {
  it("normalizes email case/whitespace and trims the name", () => {
    expect(parseLeaving([leaving({ name: "  Jo Park ", email: "  Stu@WISC.edu " })])).toEqual([
      { email: "stu@wisc.edu", displayName: "Jo Park" },
    ]);
  });

  it("drops empty and non-wisc emails", () => {
    expect(parseLeaving([leaving({ email: "" }), leaving({ email: "someone@gmail.com" })])).toEqual(
      [],
    );
  });

  it("de-duplicates on normalized email, keeping the last occurrence", () => {
    const result = parseLeaving([
      leaving({ name: "First", email: "dup@wisc.edu" }),
      leaving({ name: "Second", email: "DUP@wisc.edu " }),
    ]);
    expect(result).toEqual([{ email: "dup@wisc.edu", displayName: "Second" }]);
  });

  it("returns [] for no rows (older single-sheet workbooks)", () => {
    expect(parseLeaving([])).toEqual([]);
  });
});

describe("reconcileLeaving", () => {
  it("keeps a person in both sheets active (promotion): People Coming wins", () => {
    // Ava's case: promoted dishwasher → shift lead. Her old row moved to
    // People Leaving and she got a fresh People Coming entry.
    const parsed = parseRoster(
      [row({ name: "Ava P", email: "ava@wisc.edu", positionTitle: "Student Shift Lead" })],
      TITLE_MAP,
      EXCLUDED,
    );
    const { markLeft, movedWithinWorkbook } = reconcileLeaving(
      parsed,
      parseLeaving([leaving({ name: "Ava P", email: "ava@wisc.edu" })]),
    );
    expect(markLeft).toEqual([]);
    expect(movedWithinWorkbook).toEqual([{ email: "ava@wisc.edu", displayName: "Ava P" }]);
  });

  it("treats a promotion into an admin title as a move, not a departure", () => {
    const parsed = parseRoster(
      [row({ name: "Boss B", email: "boss@wisc.edu", positionTitle: "Office Student Supervisor" })],
      TITLE_MAP,
      EXCLUDED,
    );
    const { markLeft, movedWithinWorkbook } = reconcileLeaving(
      parsed,
      parseLeaving([leaving({ name: "Boss B", email: "boss@wisc.edu" })]),
    );
    expect(markLeft).toEqual([]);
    expect(movedWithinWorkbook.map((m) => m.email)).toEqual(["boss@wisc.edu"]);
  });

  it("marks people only in People Leaving as left", () => {
    const parsed = parseRoster([row({ email: "stays@wisc.edu" })], TITLE_MAP, EXCLUDED);
    const { markLeft, movedWithinWorkbook } = reconcileLeaving(
      parsed,
      parseLeaving([leaving({ email: "gone@wisc.edu" })]),
    );
    expect(markLeft.map((l) => l.email)).toEqual(["gone@wisc.edu"]);
    expect(movedWithinWorkbook).toEqual([]);
  });

  it("handles an empty leaving sheet", () => {
    const parsed = parseRoster([row({})], TITLE_MAP, EXCLUDED);
    expect(reconcileLeaving(parsed, [])).toEqual({ markLeft: [], movedWithinWorkbook: [] });
  });
});

describe("reconcileAdmins", () => {
  it("moves an on-roster student promoted to an admin title off the student roster", () => {
    // Boss's case: dishwasher last cycle (students row, onRoster: true), now a
    // supervisor in People Coming. The admin_users upsert alone would leave the
    // stale student row active.
    const parsed = parseRoster(
      [row({ name: "Boss B", email: "boss@wisc.edu", positionTitle: "Office Student Supervisor" })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(reconcileAdmins(parsed, new Set(["boss@wisc.edu", "other@wisc.edu"]))).toEqual([
      "boss@wisc.edu",
    ]);
  });

  it("ignores admins with no active student row", () => {
    const parsed = parseRoster(
      [row({ email: "boss@wisc.edu", positionTitle: "Head Student Supervisor" })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(reconcileAdmins(parsed, new Set(["someone-else@wisc.edu"]))).toEqual([]);
  });

  it("keeps someone the workbook lists as both student and admin on the roster", () => {
    const parsed = parseRoster(
      [
        row({ email: "both@wisc.edu", positionTitle: "Office Student Supervisor" }),
        row({ email: "both@wisc.edu", positionTitle: "Culinary Assistant" }),
      ],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(reconcileAdmins(parsed, new Set(["both@wisc.edu"]))).toEqual([]);
  });

  it("de-duplicates repeated admin rows and sorts the result", () => {
    const parsed = parseRoster(
      [
        row({ email: "zed@wisc.edu", positionTitle: "Office Student Supervisor" }),
        row({ email: "abe@wisc.edu", positionTitle: "Head Student Supervisor" }),
        row({ email: "zed@wisc.edu", positionTitle: "Office Student Supervisor" }),
      ],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(reconcileAdmins(parsed, new Set(["zed@wisc.edu", "abe@wisc.edu"]))).toEqual([
      "abe@wisc.edu",
      "zed@wisc.edu",
    ]);
  });
});
