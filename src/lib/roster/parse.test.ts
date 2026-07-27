import { describe, it, expect } from "vitest";
import {
  extractRosterRows,
  parseRoster,
  parseHireDate,
  classifyStatus,
  reconcileAdmins,
  evaluateAbsenceGuard,
  RosterFormatError,
  type RawRosterRow,
} from "./parse";

const row = (over: Partial<RawRosterRow>): RawRosterRow => ({
  name: "Test Person",
  positionTitle: "Culinary Assistant",
  email: "test1@wisc.edu",
  international: "No",
  hireDate: "",
  status: "Active",
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
  ["retail and cafe team member", "barista"],
]);

// Injected excluded-title set mirroring the SKIP_TITLES fixture (the importer
// builds the real one from app_settings via effectiveExcludedTitles).
const EXCLUDED: ReadonlySet<string> = new Set(["dining advisor board member (dab)"]);

describe("extractRosterRows", () => {
  // The tracker's real shape: a merged section banner above the real header.
  const TRACKER_HEADER = [
    ["Employee Information", "Employee Information", "Employee Information", "", "", "", ""],
    ["Name", "Campus ID", "Title", "Status", "Email", "Cell Phone", "International"],
  ];

  it("finds the header on row 2 when a section banner sits above it", () => {
    const rows = extractRosterRows([
      ...TRACKER_HEADER,
      ["Roe, Jamie", "0000000000", "Student Stocker", "Inactive", "jr@wisc.edu", "555", "No"],
    ]);
    expect(rows).toEqual([
      {
        name: "Roe, Jamie",
        positionTitle: "Student Stocker",
        email: "jr@wisc.edu",
        international: "No",
        hireDate: "",
        status: "Inactive",
      },
    ]);
  });

  it("reads an older single-header sheet with a Position Title column", () => {
    const rows = extractRosterRows([
      ["Name", "Position Title", "Email", "International? (Y/N)", "Start Date"],
      ["Ann A", "Culinary Assistant", "ann@wisc.edu", "Yes", "2025-08-20"],
    ]);
    expect(rows[0]).toMatchObject({
      positionTitle: "Culinary Assistant",
      international: "Yes",
      hireDate: "2025-08-20",
      // No Status column at all: blank, which classifies as active.
      status: "",
    });
  });

  it("prefers the exact Email column over other columns containing 'email'", () => {
    const rows = extractRosterRows([
      ["Name", "Welcome Email", "Email", "Title", "International"],
      ["Ann A", "sent", "ann@wisc.edu", "Dishwasher", "No"],
    ]);
    expect(rows[0]?.email).toBe("ann@wisc.edu");
  });

  it("locates columns by header text, so sheets may order them differently", () => {
    const rows = extractRosterRows([
      ["Email", "International", "Name", "Title"],
      ["ann@wisc.edu", "Yes", "Ann A", "Cashier"],
    ]);
    expect(rows[0]).toMatchObject({
      name: "Ann A",
      email: "ann@wisc.edu",
      positionTitle: "Cashier",
    });
  });

  it("reads every data row, including after a blank row mid-sheet", () => {
    const rows = extractRosterRows([
      ...TRACKER_HEADER,
      ["Ann A", "", "Dishwasher", "Active", "ann@wisc.edu", "", "No"],
      ["", "", "", "", "", "", ""],
      ["Bob B", "", "Cashier", "Active", "bob@wisc.edu", "", "No"],
    ]);
    expect(rows.map((r) => r.email)).toEqual(["ann@wisc.edu", "bob@wisc.edu"]);
  });

  it("trims cells and tolerates short rows", () => {
    const rows = extractRosterRows([
      ["Name", "Title", "Email", "International"],
      ["  Ann A  ", " Dishwasher ", " ann@wisc.edu ", "No"],
      ["Bob B", "Cashier", "bob@wisc.edu"],
    ]);
    expect(rows[0]).toMatchObject({ name: "Ann A", positionTitle: "Dishwasher" });
    expect(rows[1]?.international).toBe("");
  });

  it("throws when no row carries both Name and Email", () => {
    expect(() => extractRosterRows([["Employee Information"], ["Campus ID", "Title"]])).toThrow(
      RosterFormatError,
    );
  });

  it("throws when a required column is missing", () => {
    expect(() => extractRosterRows([["Name", "Email", "Title"]])).toThrow(/International/);
  });
});

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

  it("maps cafe team members to barista, accented or not", () => {
    const { students } = parseRoster(
      [
        row({ email: "a@wisc.edu", positionTitle: "Retail and Café Team Member" }),
        row({ email: "b@wisc.edu", positionTitle: "Retail and Cafe Team Member" }),
        row({ email: "c@wisc.edu", positionTitle: "Southeast Cafe Team Member" }),
      ],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students.map((s) => s.positionId)).toEqual(["barista", "barista", "barista"]);
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
    // Not counted as seen: an excluded title means they're no longer tracked here.
    expect(r.seenEmails.size).toBe(0);
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
    expect(unmappedTitles.get("mystery role")).toBe(2);
  });

  it("skips rows with missing or non-wisc emails", () => {
    const { students, skipped, seenEmails } = parseRoster(
      [row({ email: "" }), row({ email: "someone@gmail.com" })],
      TITLE_MAP,
      EXCLUDED,
    );
    expect(students).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["missing_email", "non_wisc_email"]);
    expect(seenEmails.size).toBe(0);
  });

  it("carries a parsed start date onto the student", () => {
    const { students } = parseRoster([row({ hireDate: "2023/09/07" })], TITLE_MAP, EXCLUDED);
    expect(students[0]?.hiredOn?.toISOString()).toBe("2023-09-07T00:00:00.000Z");
  });

  describe("status", () => {
    it("routes Inactive rows to the off-roster bucket, not to students", () => {
      const r = parseRoster(
        [
          row({ email: "gone@wisc.edu", name: "Gone Person", status: "Inactive" }),
          row({ email: "here@wisc.edu", status: "Active" }),
        ],
        TITLE_MAP,
        EXCLUDED,
      );
      expect(r.students.map((s) => s.email)).toEqual(["here@wisc.edu"]);
      expect(r.inactive).toEqual([{ email: "gone@wisc.edu", displayName: "Gone Person" }]);
      // Both were listed, so neither counts as missing from the sheet.
      expect([...r.seenEmails].sort()).toEqual(["gone@wisc.edu", "here@wisc.edu"]);
    });

    it("does not classify an Inactive supervisor as an admin", () => {
      const r = parseRoster(
        [row({ positionTitle: "Office Student Supervisor", status: "Inactive" })],
        TITLE_MAP,
        EXCLUDED,
      );
      expect(r.admins).toHaveLength(0);
      expect(r.inactive).toHaveLength(1);
    });

    it("keeps a row with an unrecognized status active and reports the value", () => {
      const r = parseRoster(
        [row({ email: "t@wisc.edu", status: "Transfer" }), row({ status: "Transfer" })],
        TITLE_MAP,
        EXCLUDED,
      );
      expect(r.students).toHaveLength(2);
      expect(r.inactive).toHaveLength(0);
      expect(r.unrecognizedStatuses.get("Transfer")).toBe(2);
    });

    it("treats a blank status as active without reporting it", () => {
      const r = parseRoster([row({ status: "" })], TITLE_MAP, EXCLUDED);
      expect(r.students).toHaveLength(1);
      expect(r.unrecognizedStatuses.size).toBe(0);
    });
  });
});

describe("classifyStatus", () => {
  it("reads Active and Inactive regardless of case and padding", () => {
    expect(classifyStatus(" ACTIVE ")).toBe("active");
    expect(classifyStatus("inactive")).toBe("inactive");
  });

  it("treats a blank status as active", () => {
    expect(classifyStatus("")).toBe("active");
  });

  it("reports anything else rather than guessing", () => {
    expect(classifyStatus("Transfer")).toBe("unrecognized");
  });
});

describe("parseHireDate", () => {
  it("parses a yyyy-mm-dd string to UTC midnight", () => {
    expect(parseHireDate("2025-08-20")?.toISOString()).toBe("2025-08-20T00:00:00.000Z");
  });

  it("parses the tracker's yyyy/mm/dd start dates", () => {
    expect(parseHireDate("2023/09/07")?.toISOString()).toBe("2023-09-07T00:00:00.000Z");
  });

  it("accepts an ISO datetime prefix", () => {
    expect(parseHireDate("2025-08-20T00:00:00.000Z")?.toISOString()).toBe(
      "2025-08-20T00:00:00.000Z",
    );
  });

  it("returns null for blank or unrecognized values", () => {
    expect(parseHireDate("")).toBeNull();
    expect(parseHireDate("not a date")).toBeNull();
    expect(parseHireDate("2-Mar")).toBeNull();
  });
});

describe("reconcileAdmins", () => {
  it("moves an on-roster student promoted to an admin title off the student roster", () => {
    // Boss's case: dishwasher last cycle (students row, onRoster: true), now a
    // supervisor in the sheet. The admin_users upsert alone would leave the
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

  it("keeps someone the sheet lists as both student and admin on the roster", () => {
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

describe("evaluateAbsenceGuard", () => {
  it("applies a normal number of absences", () => {
    // 88 on roster → limit 18; 5 missing is routine turnover.
    expect(evaluateAbsenceGuard(5, 88)).toEqual({ limit: 18, tripped: false, applied: true });
  });

  it("stops an import that would take too much of the roster off", () => {
    const result = evaluateAbsenceGuard(60, 88);
    expect(result.tripped).toBe(true);
    expect(result.applied).toBe(false);
  });

  it("applies anyway with the override", () => {
    const result = evaluateAbsenceGuard(60, 88, true);
    expect(result.tripped).toBe(false);
    expect(result.applied).toBe(true);
  });

  it("tolerates the floor on a small roster", () => {
    // 20% of 8 is 2, but small rosters always allow up to the floor.
    expect(evaluateAbsenceGuard(9, 8)).toMatchObject({ limit: 10, applied: true });
    expect(evaluateAbsenceGuard(11, 8)).toMatchObject({ tripped: true });
  });

  it("never trips on a first import into an empty roster", () => {
    expect(evaluateAbsenceGuard(0, 0)).toMatchObject({ tripped: false, applied: true });
  });

  it("applies exactly at the limit and trips one past it", () => {
    expect(evaluateAbsenceGuard(18, 88).applied).toBe(true);
    expect(evaluateAbsenceGuard(19, 88).tripped).toBe(true);
  });
});
