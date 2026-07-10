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

describe("parseRoster", () => {
  it("maps known titles to Muster positions and parses international", () => {
    const { students } = parseRoster([
      row({ email: "ca1@wisc.edu", positionTitle: "Culinary Assistant", international: "Yes" }),
      row({ email: "sl1@wisc.edu", positionTitle: "Student Shift Lead" }),
      row({ email: "st1@wisc.edu", positionTitle: "Student Stocker" }),
    ]);
    expect(students).toEqual([
      {
        email: "ca1@wisc.edu",
        displayName: "Test Person",
        positionId: "culinary-assistant",
        international: true,
        hiredOn: null,
      },
      {
        email: "sl1@wisc.edu",
        displayName: "Test Person",
        positionId: "shift-lead",
        international: false,
        hiredOn: null,
      },
      {
        email: "st1@wisc.edu",
        displayName: "Test Person",
        positionId: "stocker",
        international: false,
        hiredOn: null,
      },
    ]);
  });

  it("maps Southeast Cafe Team Member to barista", () => {
    const { students } = parseRoster([row({ positionTitle: "Southeast Cafe Team Member" })]);
    expect(students[0]?.positionId).toBe("barista");
  });

  it("classifies supervisor titles as admins, not students", () => {
    const { admins, students } = parseRoster([
      row({ email: "boss@wisc.edu", positionTitle: "Office Student Supervisor" }),
      row({ email: "head@wisc.edu", positionTitle: "Head Student Supervisor" }),
    ]);
    expect(students).toHaveLength(0);
    expect(admins.map((a) => a.email)).toEqual(["boss@wisc.edu", "head@wisc.edu"]);
  });

  it("skips DAB members entirely (neither student nor admin)", () => {
    const r = parseRoster([row({ positionTitle: "Dining Advisor Board Member (DAB)" })]);
    expect(r.students).toHaveLength(0);
    expect(r.admins).toHaveLength(0);
    expect(r.skipped[0]?.reason).toBe("excluded_title");
  });

  it("normalizes email case/whitespace and title casing", () => {
    const { students } = parseRoster([
      row({ email: "  Stu@WISC.edu ", positionTitle: "  CULINARY   assistant " }),
    ]);
    expect(students[0]?.email).toBe("stu@wisc.edu");
    expect(students[0]?.positionId).toBe("culinary-assistant");
  });

  it("imports unknown titles as students with no position and reports them", () => {
    const { students, unmappedTitles } = parseRoster([
      row({ positionTitle: "Mystery Role" }),
      row({ positionTitle: "Mystery Role" }),
    ]);
    expect(students).toHaveLength(2);
    expect(students[0]?.positionId).toBeNull();
    expect(unmappedTitles.get("mystery role")).toBe(2);
  });

  it("skips rows with missing or non-wisc emails", () => {
    const { students, skipped } = parseRoster([
      row({ email: "" }),
      row({ email: "someone@gmail.com" }),
    ]);
    expect(students).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["missing_email", "non_wisc_email"]);
  });

  it("carries a parsed hire date onto the student", () => {
    const { students } = parseRoster([row({ hireDate: "2025-08-20" })]);
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
    const parsed = parseRoster([
      row({ name: "Ava P", email: "ava@wisc.edu", positionTitle: "Student Shift Lead" }),
    ]);
    const { markLeft, movedWithinWorkbook } = reconcileLeaving(
      parsed,
      parseLeaving([leaving({ name: "Ava P", email: "ava@wisc.edu" })]),
    );
    expect(markLeft).toEqual([]);
    expect(movedWithinWorkbook).toEqual([{ email: "ava@wisc.edu", displayName: "Ava P" }]);
  });

  it("treats a promotion into an admin title as a move, not a departure", () => {
    const parsed = parseRoster([
      row({ name: "Boss B", email: "boss@wisc.edu", positionTitle: "Office Student Supervisor" }),
    ]);
    const { markLeft, movedWithinWorkbook } = reconcileLeaving(
      parsed,
      parseLeaving([leaving({ name: "Boss B", email: "boss@wisc.edu" })]),
    );
    expect(markLeft).toEqual([]);
    expect(movedWithinWorkbook.map((m) => m.email)).toEqual(["boss@wisc.edu"]);
  });

  it("marks people only in People Leaving as left", () => {
    const parsed = parseRoster([row({ email: "stays@wisc.edu" })]);
    const { markLeft, movedWithinWorkbook } = reconcileLeaving(
      parsed,
      parseLeaving([leaving({ email: "gone@wisc.edu" })]),
    );
    expect(markLeft.map((l) => l.email)).toEqual(["gone@wisc.edu"]);
    expect(movedWithinWorkbook).toEqual([]);
  });

  it("handles an empty leaving sheet", () => {
    const parsed = parseRoster([row({})]);
    expect(reconcileLeaving(parsed, [])).toEqual({ markLeft: [], movedWithinWorkbook: [] });
  });
});

describe("reconcileAdmins", () => {
  it("moves an on-roster student promoted to an admin title off the student roster", () => {
    // Boss's case: dishwasher last cycle (students row, onRoster: true), now a
    // supervisor in People Coming. The admin_users upsert alone would leave the
    // stale student row active.
    const parsed = parseRoster([
      row({ name: "Boss B", email: "boss@wisc.edu", positionTitle: "Office Student Supervisor" }),
    ]);
    expect(reconcileAdmins(parsed, new Set(["boss@wisc.edu", "other@wisc.edu"]))).toEqual([
      "boss@wisc.edu",
    ]);
  });

  it("ignores admins with no active student row", () => {
    const parsed = parseRoster([
      row({ email: "boss@wisc.edu", positionTitle: "Head Student Supervisor" }),
    ]);
    expect(reconcileAdmins(parsed, new Set(["someone-else@wisc.edu"]))).toEqual([]);
  });

  it("keeps someone the workbook lists as both student and admin on the roster", () => {
    const parsed = parseRoster([
      row({ email: "both@wisc.edu", positionTitle: "Office Student Supervisor" }),
      row({ email: "both@wisc.edu", positionTitle: "Culinary Assistant" }),
    ]);
    expect(reconcileAdmins(parsed, new Set(["both@wisc.edu"]))).toEqual([]);
  });

  it("de-duplicates repeated admin rows and sorts the result", () => {
    const parsed = parseRoster([
      row({ email: "zed@wisc.edu", positionTitle: "Office Student Supervisor" }),
      row({ email: "abe@wisc.edu", positionTitle: "Head Student Supervisor" }),
      row({ email: "zed@wisc.edu", positionTitle: "Office Student Supervisor" }),
    ]);
    expect(reconcileAdmins(parsed, new Set(["zed@wisc.edu", "abe@wisc.edu"]))).toEqual([
      "abe@wisc.edu",
      "zed@wisc.edu",
    ]);
  });
});
