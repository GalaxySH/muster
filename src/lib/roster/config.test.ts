import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_COLUMNS,
  DEFAULT_ROSTER_CONFIG,
  cleanRosterReading,
  parseRosterConfig,
  validateRosterReading,
} from "./config";

describe("parseRosterConfig", () => {
  it("is the built-in defaults when nothing is stored", () => {
    expect(parseRosterConfig(null)).toEqual(DEFAULT_ROSTER_CONFIG);
    expect(parseRosterConfig("")).toEqual(DEFAULT_ROSTER_CONFIG);
  });

  it("falls back to the defaults on unreadable or misshapen JSON", () => {
    expect(parseRosterConfig("{not json")).toEqual(DEFAULT_ROSTER_CONFIG);
    expect(parseRosterConfig("[1,2]")).toEqual(DEFAULT_ROSTER_CONFIG);
    expect(parseRosterConfig('"Gordon"')).toEqual(DEFAULT_ROSTER_CONFIG);
  });

  it("reads a full config", () => {
    const config = parseRosterConfig(
      JSON.stringify({
        sheetCandidates: ["Carson"],
        leavingSheet: "Leavers",
        adminTitles: ["Unit Supervisor"],
        excludedTitles: ["Dining Advisory Board Member (DAB)"],
        columns: { name: " Employee ", email: "UW Email", bogus: "x", startDate: 7 },
      }),
    );
    expect(config).toEqual({
      sheetCandidates: ["Carson"],
      leavingSheet: "Leavers",
      adminTitles: ["unit supervisor"],
      excludedTitles: ["dining advisory board member (dab)"],
      columns: { ...AUTOMATIC_COLUMNS, name: "Employee", email: "UW Email" },
    });
  });

  // Each field stands on its own, so a config saved before a field existed
  // keeps importing.
  it("defaults each missing field separately", () => {
    const config = parseRosterConfig(JSON.stringify({ excludedTitles: [] }));
    expect(config.sheetCandidates).toEqual(DEFAULT_ROSTER_CONFIG.sheetCandidates);
    expect(config.leavingSheet).toBe(DEFAULT_ROSTER_CONFIG.leavingSheet);
    expect(config.adminTitles).toEqual(DEFAULT_ROSTER_CONFIG.adminTitles);
    expect(config.excludedTitles).toEqual([]);
  });

  // Saved-and-empty excludes nothing; never-saved falls back further up.
  it("keeps an empty excluded list distinct from an unset one", () => {
    expect(parseRosterConfig("{}").excludedTitles).toBeNull();
    expect(parseRosterConfig('{"excludedTitles":[]}').excludedTitles).toEqual([]);
  });

  it("treats a sheet list with no usable name as unset", () => {
    expect(parseRosterConfig('{"sheetCandidates":[" ", 3]}').sheetCandidates).toEqual(
      DEFAULT_ROSTER_CONFIG.sheetCandidates,
    );
  });

  it("trims and de-duplicates names and titles", () => {
    const config = parseRosterConfig(
      JSON.stringify({ sheetCandidates: [" Gordon ", "Gordon"], adminTitles: ["A  B", "a b"] }),
    );
    expect(config.sheetCandidates).toEqual(["Gordon"]);
    expect(config.adminTitles).toEqual(["a b"]);
  });
});

describe("cleanRosterReading", () => {
  const blank = {
    sheetCandidates: "",
    leavingSheet: "",
    adminTitles: "",
    columns: AUTOMATIC_COLUMNS,
  };

  it("reads one name per line", () => {
    const reading = cleanRosterReading({
      sheetCandidates: "Carson\n\n Gordon ",
      leavingSheet: " Leavers ",
      adminTitles: "Unit  Supervisor\nHead Student Supervisor",
      columns: { ...AUTOMATIC_COLUMNS, title: " Job Title " },
    });
    expect(reading).toEqual({
      sheetCandidates: ["Carson", "Gordon"],
      leavingSheet: "Leavers",
      adminTitles: ["unit supervisor", "head student supervisor"],
      columns: { ...AUTOMATIC_COLUMNS, title: "Job Title" },
    });
  });

  it("puts blank sheet names back to the defaults", () => {
    const reading = cleanRosterReading(blank);
    expect(reading.sheetCandidates).toEqual(DEFAULT_ROSTER_CONFIG.sheetCandidates);
    expect(reading.leavingSheet).toBe(DEFAULT_ROSTER_CONFIG.leavingSheet);
  });

  // Unlike the sheets, an empty admin list is a real choice: nobody is an admin by title.
  it("keeps an empty admin title list empty", () => {
    expect(cleanRosterReading(blank).adminTitles).toEqual([]);
  });
});

describe("validateRosterReading", () => {
  const ok = cleanRosterReading({
    sheetCandidates: "Gordon",
    leavingSheet: "People Leaving",
    adminTitles: "Head Student Supervisor",
    columns: AUTOMATIC_COLUMNS,
  });

  it("accepts an ordinary reading", () => {
    expect(validateRosterReading(ok)).toBeNull();
  });

  it("refuses two columns with the same name, whatever the capitals", () => {
    expect(
      validateRosterReading({
        ...ok,
        columns: { ...AUTOMATIC_COLUMNS, name: "Email", email: "email" },
      }),
    ).toMatch(/same name/);
  });

  it("refuses an overlong name", () => {
    expect(validateRosterReading({ ...ok, leavingSheet: "x".repeat(101) })).toMatch(/under 100/);
  });
});
