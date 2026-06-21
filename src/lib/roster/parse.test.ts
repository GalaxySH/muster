import { describe, it, expect } from "vitest";
import { parseRoster, parseLeaving, type RawRosterRow, type RawLeavingRow } from "./parse";

const row = (over: Partial<RawRosterRow>): RawRosterRow => ({
  name: "Test Person",
  positionTitle: "Culinary Assistant",
  email: "test1@wisc.edu",
  international: "No",
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
      },
      {
        email: "sl1@wisc.edu",
        displayName: "Test Person",
        positionId: "shift-lead",
        international: false,
      },
      {
        email: "st1@wisc.edu",
        displayName: "Test Person",
        positionId: "stocker",
        international: false,
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
